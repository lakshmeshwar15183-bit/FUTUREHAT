// Lumixo mobile — notifications bridge. Mounted once for signed-in users.
//
// WhatsApp-class behaviour:
//   • ALWAYS present LOCAL notifications while the JS process is alive
//     (foreground + background), even when FCM is registered. Uses a stable
//     notification id (`chat:<id>`) so FCM + local collapse to one tray entry.
//   • FCM (push Edge Function + outbox) covers killed-state delivery.
//   • Suppress only for the chat currently open in the foreground.
//   • Routes taps + Reply / Mark-read / Open / Accept / Decline.
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  getCurrentUser,
  getProfile,
  sendMessage,
  markConversationRead,
  getNotificationSettings,
  updateCallStatus,
  type Message,
} from '../lib/shared';
import {
  initNotifications,
  registerForPush,
  startPushTokenRefresh,
  presentMessageNotification,
  presentCallNotification,
  presentMissedCallNotification,
  clearConversationNotification,
  clearCallNotification,
  getOpenConversation,
  setBadgeCount,
  CATEGORY,
} from '../lib/notifications';
import type { RootStackParamList } from '../navigation/types';

export default function NotificationsBridge({
  navRef,
}: {
  navRef: NavigationContainerRef<RootStackParamList>;
}) {
  const meRef = useRef<string | null>(null);
  const settingsRef = useRef<Awaited<ReturnType<typeof getNotificationSettings>> | null>(null);
  const unreadByChat = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    let msgChannel: ReturnType<typeof supabase.channel> | null = null;
    let callChannel: ReturnType<typeof supabase.channel> | null = null;
    let stopTokenRefresh: (() => void) | null = null;
    let drainTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      await initNotifications();
      await registerForPush();
      stopTokenRefresh = startPushTokenRefresh();
      if (cancelled) return;

      const me = (await getCurrentUser(supabase))?.id ?? null;
      meRef.current = me;
      if (!me) return;

      settingsRef.current = await getNotificationSettings(supabase).catch(() => null);

      // ── Local realtime message notifications (process alive) ──────────────
      // CRITICAL: always run this — do NOT disable when FCM is active.
      // Killed-state is covered by FCM; alive-state by this path. Same
      // notification id collapses duplicates on Android.
      msgChannel = supabase
        .channel(`fh-message-notify:${me}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          async (payload) => {
            try {
              const m = payload.new as Message;
              if (!m || m.sender_id === me || m.is_deleted || m.type === 'system') return;

              // Suppress only for the open foreground chat.
              if (
                AppState.currentState === 'active' &&
                getOpenConversation() === m.conversation_id
              ) {
                return;
              }

              if (!settingsRef.current) {
                settingsRef.current = await getNotificationSettings(supabase).catch(() => null);
              }
              const s = settingsRef.current;

              const { data: conv } = await supabase
                .from('conversations')
                .select('type, name')
                .eq('id', m.conversation_id)
                .maybeSingle();
              const isGroup = ((conv as { type?: string } | null)?.type ?? 'direct') === 'group';
              if (s) {
                if (isGroup ? s.groupMute : s.messageMute) return;
              }

              // Per-chat mute table
              const { data: muteRow } = await supabase
                .from('muted_conversations')
                .select('conversation_id, muted_until')
                .eq('conversation_id', m.conversation_id)
                .eq('user_id', me)
                .maybeSingle();
              if (muteRow) {
                const until = (muteRow as any).muted_until;
                if (!until || new Date(until).getTime() > Date.now()) return;
              }

              // Chat Lock: notify but never reveal sender/preview.
              const { data: lockRow } = await supabase
                .from('locked_conversations')
                .select('conversation_id')
                .eq('conversation_id', m.conversation_id)
                .eq('user_id', me)
                .maybeSingle();
              const isLocked = !!lockRow;

              const sender = await getProfile(supabase, m.sender_id).catch(() => null);
              const convName = (conv as { name?: string | null } | null)?.name ?? 'Group';
              const showPreview = (s ? s.messagePreview !== false : true) && !isLocked;
              const title = isLocked
                ? 'Lumixo'
                : isGroup
                  ? convName
                  : (sender?.display_name ?? 'Lumixo');
              const body = isLocked
                ? 'New message'
                : isGroup
                  ? showPreview
                    ? `${sender?.display_name ?? 'Someone'}: ${previewOf(m)}`
                    : 'New message'
                  : showPreview
                    ? previewOf(m)
                    : 'New message';

              // Badge: bump per-chat unread estimate.
              const prev = unreadByChat.current.get(m.conversation_id) ?? 0;
              unreadByChat.current.set(m.conversation_id, prev + 1);
              const total = [...unreadByChat.current.values()].reduce((a, b) => a + b, 0);
              void setBadgeCount(total);

              await presentMessageNotification({
                conversationId: m.conversation_id,
                title,
                body,
                isGroup,
                messageId: m.id,
                senderAvatar: sender?.avatar_url ?? undefined,
              });
            } catch (e) {
              console.warn('[notify] message handler', e);
            }
          },
        )
        .subscribe();

      // ── Incoming call rows (backup when CallContext subscription is late) ─
      callChannel = supabase
        .channel(`fh-call-notify:${me}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'calls' },
          async (payload) => {
            try {
              const call = payload.new as {
                id: string;
                conversation_id: string;
                caller_id: string;
                type: string;
                status: string;
              };
              if (!call || call.caller_id === me || call.status !== 'ringing') return;
              // CallContext owns the full-screen UI when active; still raise a
              // high-priority tray notification when backgrounded/locked.
              if (AppState.currentState === 'active') return;
              const peer = await getProfile(supabase, call.caller_id).catch(() => null);
              await presentCallNotification({
                callId: call.id,
                conversationId: call.conversation_id,
                title: peer?.display_name ?? 'Lumixo',
                video: call.type === 'video',
              });
            } catch { /* ignore */ }
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'calls' },
          async (payload) => {
            try {
              const call = payload.new as { id: string; status: string; conversation_id: string; caller_id: string; type: string };
              if (!call) return;
              if (['ended', 'declined', 'accepted', 'missed'].includes(call.status)) {
                await clearCallNotification(call.id);
              }
              if (call.status === 'missed' && call.caller_id !== me) {
                const peer = await getProfile(supabase, call.caller_id).catch(() => null);
                await presentMissedCallNotification({
                  callId: call.id,
                  conversationId: call.conversation_id,
                  title: peer?.display_name ?? 'Someone',
                  isVideo: call.type === 'video',
                });
              }
            } catch { /* ignore */ }
          },
        )
        .subscribe();

      // Periodically kick the server outbox drain (best-effort) so DB-triggered
      // push jobs flush even if the sender's client didn't call sendPush.
      const kickDrain = () => {
        void supabase.functions.invoke('push', { body: { drainOutbox: true, limit: 30 } }).catch(() => {});
      };
      kickDrain();
      drainTimer = setInterval(kickDrain, 45_000);
    })();

    // ── Taps + action buttons ───────────────────────────────────────────────
    const respSub = Notifications.addNotificationResponseReceivedListener(async (resp) => {
      const data = resp.notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;
      const action = resp.actionIdentifier;
      const userText = (resp as any).userText as string | undefined;

      // Default expo "open" identifier
      const isDefault =
        action === Notifications.DEFAULT_ACTION_IDENTIFIER ||
        action === 'expo.modules.notifications.actions.DEFAULT' ||
        !action;

      if (data.type === 'message' || data.type === 'mention' || data.kind === 'message' || data.kind === 'group') {
        const convId = data.conversationId;
        if (!convId) return;

        if (action === 'reply' && userText) {
          await sendMessage(supabase, convId, userText, 'text').catch(() => {});
          await clearConversationNotification(convId);
          unreadByChat.current.delete(convId);
          void setBadgeCount([...unreadByChat.current.values()].reduce((a, b) => a + b, 0));
          return;
        }
        if (action === 'mark_read') {
          await markConversationRead(supabase, convId).catch(() => {});
          await clearConversationNotification(convId);
          unreadByChat.current.delete(convId);
          void setBadgeCount([...unreadByChat.current.values()].reduce((a, b) => a + b, 0));
          return;
        }
        if (isDefault || action === 'open') {
          await clearConversationNotification(convId);
          unreadByChat.current.delete(convId);
          void setBadgeCount([...unreadByChat.current.values()].reduce((a, b) => a + b, 0));
          navRef.navigate('Chat' as any, { conversationId: convId, title: '' });
        }
        return;
      }

      if (data.type === 'call' || data.kind === 'call') {
        const callId = data.callId;
        const convId = data.conversationId;
        if (action === 'accept' && callId) {
          await updateCallStatus(supabase, callId, 'accepted').catch(() => {});
          await clearCallNotification(callId);
          navRef.navigate('Main' as any);
          return;
        }
        if (action === 'decline' && callId) {
          await updateCallStatus(supabase, callId, 'declined').catch(() => {});
          await clearCallNotification(callId);
          return;
        }
        if (isDefault || action === 'open') {
          if (callId) await clearCallNotification(callId);
          navRef.navigate('Main' as any);
        }
        return;
      }

      if (data.type === 'missed_call' || data.kind === 'missed_call') {
        if (data.conversationId) {
          navRef.navigate('Chat' as any, {
            conversationId: data.conversationId,
            title: '',
          });
        }
        return;
      }

      if (data.type === 'call_status' && data.callId) {
        await clearCallNotification(data.callId);
      }
    });

    // Foreground FCM receipt → also handle call cancel silently.
    const recvSub = Notifications.addNotificationReceivedListener(async (notification) => {
      const data = notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;
      if (data.type === 'call_status' && data.callId) {
        await clearCallNotification(data.callId);
      }
      // If a message FCM arrives for the open chat, dismiss immediately.
      if (
        (data.type === 'message' || data.kind === 'message' || data.kind === 'group') &&
        data.conversationId &&
        AppState.currentState === 'active' &&
        getOpenConversation() === data.conversationId
      ) {
        await clearConversationNotification(data.conversationId);
      }
    });

    return () => {
      cancelled = true;
      if (msgChannel) supabase.removeChannel(msgChannel);
      if (callChannel) supabase.removeChannel(callChannel);
      respSub.remove();
      recvSub.remove();
      stopTokenRefresh?.();
      if (drainTimer) clearInterval(drainTimer);
    };
  }, [navRef]);

  // Clear badge for open chat is handled by ChatScreen via clearConversationNotification.
  return null;
}

function previewOf(m: Message): string {
  if (m.type === 'text') return (m.content || 'Message').slice(0, 180);
  const map: Record<string, string> = {
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎤 Voice message',
    voice: '🎤 Voice message',
    file: '📎 Document',
    gif: 'GIF',
    sticker: 'Sticker',
  };
  return map[m.type] ?? 'New message';
}

// silence unused on platforms without CATEGORY import side-effects
void Platform;
void CATEGORY;
