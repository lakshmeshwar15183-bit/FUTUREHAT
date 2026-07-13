// Lumixo mobile — notifications bridge. Mounted once for signed-in users.
//
// WhatsApp-class behaviour:
//   • LOCAL notifications while JS is alive (same id as FCM → collapse).
//   • FCM + outbox cover killed / Doze delivery.
//   • Suppress for open foreground chat.
//   • Multi-device: clear tray when chat is read (receipts + silent clear_chat push).
//   • Actions: Reply / Mark read / Mute / Archive / Accept / Decline.
//   • Badge synced from server (my_total_unread).
//   • Outbox drain on app-active + boot (event-driven, not aggressive poll).
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  getCurrentUser,
  getProfile,
  sendMessage,
  markConversationRead,
  markMessageAsDelivered,
  getNotificationSettings,
  muteConversation,
  archiveConversation,
  clearRemoteChatNotification,
  sendPush,
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
  syncBadgeFromServer,
  messagePreviewText,
} from '../lib/notifications';
import {
  nativeClearPendingCallAction,
  nativeGetPendingCallAction,
  subscribeNativeIncomingCallActions,
} from '../lib/incomingCallNative';
import { recordDelivery } from '../lib/notifLatency';
import { useCalls } from '../calls/CallContext';
import type { RootStackParamList } from '../navigation/types';

export default function NotificationsBridge({
  navRef,
}: {
  navRef: NavigationContainerRef<RootStackParamList>;
}) {
  const { acceptCallById, declineCallById } = useCalls();
  const acceptCallByIdRef = useRef(acceptCallById);
  const declineCallByIdRef = useRef(declineCallById);
  useEffect(() => { acceptCallByIdRef.current = acceptCallById; }, [acceptCallById]);
  useEffect(() => { declineCallByIdRef.current = declineCallById; }, [declineCallById]);

  // Drain native Decline (and similar) actions that ran without launching the app.
  useEffect(() => {
    let alive = true;

    const applyPending = async () => {
      const pending = await nativeGetPendingCallAction();
      if (!alive || !pending?.callId) return;
      if (pending.action === 'decline') {
        await declineCallByIdRef.current(pending.callId);
        await clearCallNotification(pending.callId);
      }
      // Mute is ring-only on native — no server status change.
      await nativeClearPendingCallAction();
    };

    void applyPending();
    const unsubNative = subscribeNativeIncomingCallActions((payload) => {
      if (!payload.callId) return;
      if (payload.action === 'decline') {
        void declineCallByIdRef.current(payload.callId);
        void clearCallNotification(payload.callId);
        void nativeClearPendingCallAction();
      }
      if (payload.action === 'ended' || payload.action === 'missed') {
        // Caller hung up — drop ring UI + tray if this call is showing.
        void clearCallNotification(payload.callId);
      }
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void applyPending();
    });

    return () => {
      alive = false;
      unsubNative();
      appSub.remove();
    };
  }, []);

  const meRef = useRef<string | null>(null);
  const settingsRef = useRef<Awaited<ReturnType<typeof getNotificationSettings>> | null>(null);
  const seenMsgIds = useRef<Set<string>>(new Set());
  const seenCallIds = useRef<Set<string>>(new Set());
  const clearDebounce = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    let cancelled = false;
    let msgChannel: ReturnType<typeof supabase.channel> | null = null;
    let callChannel: ReturnType<typeof supabase.channel> | null = null;
    let receiptChannel: ReturnType<typeof supabase.channel> | null = null;
    let stopTokenRefresh: (() => void) | null = null;
    let appStateSub: { remove: () => void } | null = null;

    // Global outbox drain is cron/service-role only (push Edge seal).
    // Clients must not claim everyone else's outbox. Rely on DB triggers +
    // sender fan-out + scheduled cron with CRON_SECRET.
    const kickDrain = () => { /* no-op: user JWT cannot drain global outbox */ };

    const refreshBadge = () => {
      void syncBadgeFromServer();
    };

    /** Debounced clear + badge (multi-device read storms). */
    const clearChatTray = (conversationId: string) => {
      const prev = clearDebounce.current.get(conversationId);
      if (prev) clearTimeout(prev);
      clearDebounce.current.set(
        conversationId,
        setTimeout(() => {
          clearDebounce.current.delete(conversationId);
          void clearConversationNotification(conversationId);
          refreshBadge();
        }, 120),
      );
    };

    (async () => {
      await initNotifications();
      await registerForPush();
      stopTokenRefresh = startPushTokenRefresh();
      if (cancelled) return;

      const me = (await getCurrentUser(supabase))?.id ?? null;
      meRef.current = me;
      if (!me) return;

      settingsRef.current = await getNotificationSettings(supabase).catch(() => null);
      refreshBadge();
      kickDrain();

      // ── Local realtime message notifications (process alive) ──────────────
      msgChannel = supabase
        .channel(`fh-message-notify:${me}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          async (payload) => {
            try {
              const m = payload.new as Message;
              if (!m || m.sender_id === me || m.is_deleted || m.type === 'system') return;
              if (m.id) {
                if (seenMsgIds.current.has(m.id)) return;
                seenMsgIds.current.add(m.id);
                if (seenMsgIds.current.size > 800) {
                  const drop = [...seenMsgIds.current].slice(0, 300);
                  drop.forEach((id) => seenMsgIds.current.delete(id));
                }
              }

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
                .select('type, name, avatar_url')
                .eq('id', m.conversation_id)
                .maybeSingle();
              const isGroup = ((conv as { type?: string } | null)?.type ?? 'direct') === 'group';
              if (s) {
                if (isGroup ? s.groupMute : s.messageMute) return;
              }

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
              const isMention =
                isGroup &&
                m.type === 'text' &&
                typeof m.content === 'string' &&
                m.content.includes('@');

              const title = isLocked
                ? 'Lumixo'
                : isGroup
                  ? convName
                  : (sender?.display_name ?? 'Lumixo');
              const preview = messagePreviewText(m);
              const body = isLocked
                ? 'New message'
                : isGroup
                  ? showPreview
                    ? `${sender?.display_name ?? 'Someone'}: ${preview}`
                    : 'New message'
                  : showPreview
                    ? preview
                    : 'New message';

              await presentMessageNotification({
                conversationId: m.conversation_id,
                title,
                body,
                isGroup,
                isMention,
                messageId: m.id,
                senderAvatar:
                  isGroup
                    ? (conv as { avatar_url?: string | null } | null)?.avatar_url ??
                      sender?.avatar_url ??
                      undefined
                    : sender?.avatar_url ?? undefined,
              });
              // Realtime local present ≈ 0ms from client POV; stamp for diagnostics.
              void recordDelivery({ kind: 'message', messageId: m.id, sentAt: Date.now() });

              refreshBadge();
            } catch (e) {
              console.warn('[notify] message handler', e);
            }
          },
        )
        .subscribe();

      // ── Multi-device: I read somewhere → clear tray here ──────────────────
      // Fires when THIS user inserts read receipts (any device that shares the
      // same account). Debounced per conversation.
      receiptChannel = supabase
        .channel(`fh-receipt-clear:${me}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'message_receipts',
            filter: `user_id=eq.${me}`,
          },
          async (payload) => {
            try {
              const row = payload.new as { message_id?: string; status?: string };
              if (!row?.message_id || row.status !== 'read') return;
              const { data: msg } = await supabase
                .from('messages')
                .select('conversation_id')
                .eq('id', row.message_id)
                .maybeSingle();
              const cid = (msg as { conversation_id?: string } | null)?.conversation_id;
              if (cid) clearChatTray(cid);
            } catch { /* ignore */ }
          },
        )
        .subscribe();

      // ── Incoming call rows ────────────────────────────────────────────────
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
              if (seenCallIds.current.has(call.id)) return;
              seenCallIds.current.add(call.id);

              if (AppState.currentState === 'active') return;

              const peer = await getProfile(supabase, call.caller_id).catch(() => null);
              await presentCallNotification({
                callId: call.id,
                conversationId: call.conversation_id,
                title: peer?.display_name ?? 'Lumixo',
                video: call.type === 'video',
                avatarUrl: peer?.avatar_url ?? undefined,
              });
            } catch { /* ignore */ }
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'calls' },
          async (payload) => {
            try {
              const call = payload.new as {
                id: string;
                status: string;
                conversation_id: string;
                caller_id: string;
                type: string;
              };
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
    })();

    appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        kickDrain();
        refreshBadge();
        // Re-assert FCM token after long background (OEM kills).
        void registerForPush();
      }
    });

    // Shared handler for tap / action (live listener + cold start after kill).
    const handleResponse = async (resp: Notifications.NotificationResponse) => {
      const data = resp.notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;
      const action = resp.actionIdentifier;
      const userText = (resp as { userText?: string }).userText;

      const isDefault =
        action === Notifications.DEFAULT_ACTION_IDENTIFIER ||
        action === 'expo.modules.notifications.actions.DEFAULT' ||
        !action;

      if (
        data.type === 'message' ||
        data.type === 'mention' ||
        data.kind === 'message' ||
        data.kind === 'group' ||
        data.kind === 'mention'
      ) {
        const convId = data.conversationId;
        if (!convId) return;

        if (action === 'reply' && userText?.trim()) {
          // Only clear tray + push on confirmed send. Silent catch previously
          // made users believe the reply went through when it failed.
          try {
            const { message, error } = await sendMessage(
              supabase, convId, userText.trim(), 'text',
            );
            if (error || !message) {
              if (typeof __DEV__ !== 'undefined' && __DEV__) {
                console.warn('[notif] reply failed', error?.message);
              }
              return;
            }
            void sendPush(supabase, {
              conversationId: convId,
              kind: 'message',
              title: '',
              body: userText.trim().slice(0, 180),
              data: {
                type: 'message',
                messageId: message.id,
                messageType: 'text',
              },
            });
            await clearConversationNotification(convId);
            void clearRemoteChatNotification(supabase, convId);
            refreshBadge();
          } catch (e) {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.warn('[notif] reply exception', e);
            }
          }
          return;
        }
        if (action === 'mark_read') {
          await markConversationRead(supabase, convId).catch(() => {});
          await clearConversationNotification(convId);
          void clearRemoteChatNotification(supabase, convId);
          refreshBadge();
          return;
        }
        if (action === 'mute') {
          await muteConversation(supabase, convId).catch(() => {});
          await clearConversationNotification(convId);
          return;
        }
        if (action === 'archive') {
          await archiveConversation(supabase, convId).catch(() => {});
          await clearConversationNotification(convId);
          refreshBadge();
          return;
        }
        if (isDefault || action === 'open') {
          await clearConversationNotification(convId);
          refreshBadge();
          if (navRef.isReady()) {
            navRef.navigate('Chat' as any, { conversationId: convId, title: '' });
          } else {
            // Nav may not be ready on cold start — retry once.
            setTimeout(() => {
              try {
                navRef.navigate('Chat' as any, { conversationId: convId, title: '' });
              } catch { /* ignore */ }
            }, 400);
          }
        }
        return;
      }

      if (data.type === 'call' || data.kind === 'call' || data.type === 'ongoing_call') {
        const callId = data.callId;
        // Answer only — native Decline/Mute never open the app (BroadcastReceiver).
        if ((action === 'accept' || action === 'answer') && callId) {
          await acceptCallByIdRef.current(callId);
          navRef.navigate('Main' as any);
          return;
        }
        if (action === 'decline' && callId) {
          // Expo-notifications fallback path (iOS / no native module).
          await declineCallByIdRef.current(callId);
          await clearCallNotification(callId);
          return;
        }
        if (action === 'mute' && callId) {
          // Ring mute only — keep call ringing server-side; user can still Answer.
          return;
        }
        // Body tap / default open → show in-app incoming UI (not auto-answer).
        if (isDefault || action === 'open') {
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

      if (data.type === 'clear_chat' && data.conversationId) {
        clearChatTray(data.conversationId);
      }

      if (data.type === 'community_announcement' && data.communityId) {
        navRef.navigate('Main' as any);
      }
    };

    // ── Cold start: user tapped a notification while app was killed ─────────
    void Notifications.getLastNotificationResponseAsync()
      .then((last) => {
        if (last && !cancelled) void handleResponse(last);
      })
      .catch(() => {});

    // ── Taps + action buttons (process alive) ───────────────────────────────
    const respSub = Notifications.addNotificationResponseReceivedListener((resp) => {
      void handleResponse(resp);
    });

    // Foreground FCM receipt — silent cancels, open-chat dismiss, multi-device clear.
    const recvSub = Notifications.addNotificationReceivedListener(async (notification) => {
      const data = notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;

      if (data.type === 'call_status' && data.callId) {
        await clearCallNotification(data.callId);
        return;
      }

      if (data.type === 'clear_chat' && data.conversationId) {
        clearChatTray(data.conversationId);
        return;
      }

      // Latency: FCM data.sentAt → now (killed/background delivery path).
      if (data.sentAt && (data.type === 'message' || data.type === 'mention' || data.kind === 'message')) {
        void recordDelivery({
          kind: 'message',
          sentAt: data.sentAt,
          messageId: data.messageId,
        });
      }
      // Device received the push → mark delivered (sender gets grey ✓✓).
      // Works for background/killed; open-chat still upgrades to read separately.
      if (
        data.messageId &&
        (data.type === 'message' || data.type === 'mention' || data.kind === 'message' || data.kind === 'group' || data.kind === 'mention')
      ) {
        markMessageAsDelivered(supabase, data.messageId).catch(() => {});
      }
      if (data.sentAt && (data.type === 'call' || data.kind === 'call')) {
        void recordDelivery({ kind: 'call', sentAt: data.sentAt, callId: data.callId });
      }

      // Dedupe: if we already presented this messageId locally, ignore FCM echo.
      if (data.messageId && seenMsgIds.current.has(data.messageId)) {
        return;
      }
      if (data.messageId) {
        seenMsgIds.current.add(data.messageId);
      }

      if (
        (data.type === 'message' ||
          data.type === 'mention' ||
          data.kind === 'message' ||
          data.kind === 'group' ||
          data.kind === 'mention') &&
        data.conversationId &&
        AppState.currentState === 'active' &&
        getOpenConversation() === data.conversationId
      ) {
        await clearConversationNotification(data.conversationId);
      }
      if (data.type === 'message' || data.type === 'mention') {
        refreshBadge();
      }
    });

    return () => {
      cancelled = true;
      if (msgChannel) supabase.removeChannel(msgChannel);
      if (callChannel) supabase.removeChannel(callChannel);
      if (receiptChannel) supabase.removeChannel(receiptChannel);
      respSub.remove();
      recvSub.remove();
      stopTokenRefresh?.();
      appStateSub?.remove();
      clearDebounce.current.forEach((t) => clearTimeout(t));
      clearDebounce.current.clear();
    };
  }, [navRef]);

  return null;
}

void setBadgeCount;
