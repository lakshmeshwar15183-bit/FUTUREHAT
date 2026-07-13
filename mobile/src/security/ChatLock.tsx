// Lumixo mobile — Chat Lock (0027). Per-chat lock secured entirely by the
// DEVICE's own authentication (Android BiometricPrompt / iOS LocalAuthentication →
// fingerprint / face / device PIN). Lumixo NEVER stores a PIN, password, or
// biometric — it only tracks WHICH conversations are locked (synced via
// locked_conversations) and the auto-lock timing (extra.chatLock).
//
// Model (WhatsApp-style): all locked chats live in one "Locked chats" area that is
// hidden until the user authenticates once (`unlock()`). While unlocked, locked
// chats are visible/openable; on app-background or after the configured auto-lock
// delay the area re-locks (`relock()`), hiding them again.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import { supabase } from '../lib/supabase';
import {
  getLockedIds,
  getChatLockSettings,
  DEFAULT_CHAT_LOCK,
  getCurrentUser,
  type ChatLockSettings,
} from '../lib/shared';
import { getCache, setCache, pendingConversationEffects, reconcileIds, mergeEffects } from '../lib/localCache';
import { queueAction } from '../lib/sync';

interface ChatLockValue {
  /** Conversation ids the user has locked (synced). */
  lockedIds: Set<string>;
  settings: ChatLockSettings;
  /** Device has some secure auth we can invoke (biometric or device credential). */
  available: boolean;
  /** True while the Locked chats area is authenticated/visible this session. */
  unlocked: boolean;
  isLocked: (conversationId: string) => boolean;
  /** Run the device authentication prompt. Resolves true on success. */
  authenticate: (promptMessage?: string) => Promise<boolean>;
  /** Authenticate, then reveal the Locked chats area on success. */
  unlock: (promptMessage?: string) => Promise<boolean>;
  /** Hide the Locked chats area again (re-lock). */
  relock: () => void;
  /** Lock / unlock a specific chat (optimistic + queued sync). */
  lockChat: (conversationId: string) => void;
  unlockChat: (conversationId: string) => void;
  /** Re-read locked ids + settings from the server (call on focus / after change). */
  refresh: () => Promise<void>;
  setSettings: (patch: Partial<ChatLockSettings>) => void;
}

const Ctx = createContext<ChatLockValue | null>(null);

const CK_IDS = 'chatlock:ids';
const CK_SETTINGS = 'chatlock:settings';

export function ChatLockProvider({ children }: { children: React.ReactNode }) {
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [settings, setSettingsState] = useState<ChatLockSettings>(DEFAULT_CHAT_LOCK);
  const [available, setAvailable] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const unlockedRef = useRef(unlocked);
  useEffect(() => { unlockedRef.current = unlocked; }, [unlocked]);
  const appState = useRef(AppState.currentState);
  const relockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect what the device can do. Chat Lock is available whenever the device has
  // ANY enrolled secure credential the OS can prompt for — biometric (fingerprint /
  // face) OR a device PIN / pattern / passcode. getEnrolledLevelAsync() reports
  // exactly that: SECRET = a device credential is set, BIOMETRIC_* = biometrics
  // enrolled, NONE = the device has no secure lock at all. This is the correct
  // gate: `hasHardwareAsync()` was too loose (true on a phone with a fingerprint
  // sensor but nothing enrolled → auth can't actually run) and `isEnrolledAsync()`
  // was too strict (false on a PIN/pattern-only device that Chat Lock supports).
  useEffect(() => {
    (async () => {
      try {
        const level = await LocalAuthentication.getEnrolledLevelAsync();
        setAvailable(level !== LocalAuthentication.SecurityLevel.NONE);
      } catch {
        // Fall back to the older probe if the level API is unavailable.
        try {
          const hw = await LocalAuthentication.hasHardwareAsync();
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          setAvailable(hw && enrolled);
        } catch {
          setAvailable(false);
        }
      }
    })();
  }, []);

  // Instant hydrate from cache (offline-safe), then reconcile from the server.
  const refresh = useCallback(async () => {
    const me = await getCurrentUser(supabase).catch(() => null);
    if (!me?.id) return;

    // Settings are independent and safe to refresh regardless of the lock read.
    getChatLockSettings(supabase)
      .then((s) => { setSettingsState(s); setCache(`${CK_SETTINGS}:${me.id}`, s).catch(() => {}); })
      .catch(() => { /* offline — keep cached settings */ });

    // Capture in-flight lock/unlock effects BEFORE the server read, so an action
    // that completes (and leaves the queue) mid-read is still honoured.
    const effBefore = await pendingConversationEffects(['lockChat'], ['unlockChat']);
    // Locked ids: only overwrite from the server when the read SUCCEEDS. A failed
    // read (offline, or `locked_conversations` not yet migrated) must NOT wipe the
    // user's locally-locked chats — that was the "toggle flips back to Off" bug.
    let serverIds: string[];
    try {
      serverIds = await getLockedIds(supabase);
    } catch {
      return; // preserve cached / optimistic locks
    }
    // Fold in any lock/unlock whose queued sync hasn't landed yet, so a fresh
    // server read never reverts a chat the user just toggled (race the spec calls
    // out: "stale backend response overwriting newer local state"). Merge the
    // before/after queue snapshots so the change survives even if its sync landed
    // (and dequeued) in the window between the two awaits.
    const effAfter = await pendingConversationEffects(['lockChat'], ['unlockChat']);
    const merged = reconcileIds(serverIds, mergeEffects(effBefore, effAfter));
    setLockedIds(merged);
    setCache(`${CK_IDS}:${me.id}`, [...merged]).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const me = await getCurrentUser(supabase).catch(() => null);
      if (me?.id) {
        const [ids, s] = await Promise.all([
          getCache<string[]>(`${CK_IDS}:${me.id}`, []),
          getCache<ChatLockSettings>(`${CK_SETTINGS}:${me.id}`, DEFAULT_CHAT_LOCK),
        ]);
        if (ids.length) setLockedIds(new Set(ids));
        if (s) setSettingsState(s);
      }
      refresh();
    })();
  }, [refresh]);

  // Auto-lock: when the app leaves the foreground, re-lock the area after the
  // configured delay (0 = immediately). Returning within the window cancels it.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasActive = appState.current.match(/active/);
      const goingAway = next.match(/inactive|background/);
      if (wasActive && goingAway && unlockedRef.current) {
        const ms = settingsRef.current.autoLockMs ?? 0;
        if (relockTimer.current) clearTimeout(relockTimer.current);
        if (ms <= 0) {
          setUnlocked(false);
        } else {
          relockTimer.current = setTimeout(() => setUnlocked(false), ms);
        }
      }
      if (next.match(/active/) && relockTimer.current) {
        // Came back quickly — but if the whole delay already elapsed the timer
        // has fired; otherwise keep the area open.
        clearTimeout(relockTimer.current);
        relockTimer.current = null;
      }
      appState.current = next;
    });
    return () => {
      sub.remove();
      if (relockTimer.current) clearTimeout(relockTimer.current);
    };
  }, []);

  const authenticate = useCallback(async (promptMessage = 'Unlock chat') => {
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage,
        // Leave device fallback ENABLED so a device with no biometric still
        // authenticates via its PIN/pattern/password (spec requirement).
        fallbackLabel: 'Use device PIN',
        cancelLabel: 'Cancel',
      });
      return !!res.success;
    } catch {
      return false;
    }
  }, []);

  const unlock = useCallback(async (promptMessage = 'Unlock chats') => {
    const ok = await authenticate(promptMessage);
    if (ok) setUnlocked(true);
    return ok;
  }, [authenticate]);

  const relock = useCallback(() => {
    if (relockTimer.current) { clearTimeout(relockTimer.current); relockTimer.current = null; }
    setUnlocked(false);
  }, []);

  const isLocked = useCallback((id: string) => lockedIds.has(id), [lockedIds]);

  const lockChat = useCallback((conversationId: string) => {
    setLockedIds((prev) => {
      const next = new Set(prev).add(conversationId);
      getCurrentUser(supabase).then((me) => { if (me?.id) setCache(`${CK_IDS}:${me.id}`, [...next]).catch(() => {}); });
      return next;
    });
    queueAction('lockChat', { conversationId });
  }, []);

  const unlockChat = useCallback((conversationId: string) => {
    setLockedIds((prev) => {
      const next = new Set(prev);
      next.delete(conversationId);
      getCurrentUser(supabase).then((me) => { if (me?.id) setCache(`${CK_IDS}:${me.id}`, [...next]).catch(() => {}); });
      return next;
    });
    queueAction('unlockChat', { conversationId });
  }, []);

  const setSettings = useCallback((patch: Partial<ChatLockSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      getCurrentUser(supabase).then((me) => { if (me?.id) setCache(`${CK_SETTINGS}:${me.id}`, next).catch(() => {}); });
      return next;
    });
    // Synced, conflict-safe, via the extra.chatLock leaf (mirrors notifications).
    if (patch.enabled !== undefined) queueAction('mergeExtra', { path: ['chatLock', 'enabled'], value: patch.enabled });
    if (patch.autoLockMs !== undefined) queueAction('mergeExtra', { path: ['chatLock', 'autoLockMs'], value: patch.autoLockMs });
  }, []);

  return (
    <Ctx.Provider
      value={{
        lockedIds,
        settings,
        available,
        unlocked,
        isLocked,
        authenticate,
        unlock,
        relock,
        lockChat,
        unlockChat,
        refresh,
        setSettings,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useChatLock(): ChatLockValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useChatLock must be used within ChatLockProvider');
  return ctx;
}
