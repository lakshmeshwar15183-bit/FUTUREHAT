// FUTUREHAT mobile — notifications bridge. Mounted once for signed-in users. It:
//   • initialises the Android channels + registers the FCM token (killed-state),
//   • when FCM is NOT active, presents LOCAL message notifications from realtime
//     so the app still notifies while open / backgrounded / minimised,
//   • routes notification taps + Reply / Mark-read / Open actions.
// Sounds are the device system default (handled by the channel). No bundled sound.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  getCurrentUser, getProfile, sendMessage, markConversationRead,
  getNotificationSettings, type Message,
} from '../lib/shared';
import {
  initNotifications, registerForPush, isPushActive,
  presentMessageNotification, getOpenConversation, clearConversationNotification,
} from '../lib/notifications';
import type { RootStackParamList } from '../navigation/types';

export default function NotificationsBridge({ navRef }: { navRef: NavigationContainerRef<RootStackParamList> }) {
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      await initNotifications();
      await registerForPush();
      if (cancelled) return;

      const me = (await getCurrentUser(supabase))?.id;
      if (!me) return;

      // Local realtime notifier — only when FCM isn't delivering (avoids dupes).
      if (!isPushActive()) {
        let settings = await getNotificationSettings(supabase).catch(() => null);
        channel = supabase
          .channel('fh-message-notify')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
            const m = payload.new as Message;
            // Never notify for our own messages, unsent ones, or system notices.
            if (!m || m.sender_id === me || m.is_deleted || m.type === 'system') return;
            // Skip the chat that's currently open in the foreground.
            if (AppState.currentState === 'active' && getOpenConversation() === m.conversation_id) return;
            if (!settings) settings = await getNotificationSettings(supabase).catch(() => null);
            const s = settings;
            const { data: conv } = await supabase
              .from('conversations').select('type, name').eq('id', m.conversation_id).maybeSingle();
            const isGroup = ((conv as { type?: string } | null)?.type ?? 'direct') === 'group';
            if (s) {
              if (isGroup ? s.groupMute : s.messageMute) return;
            }
            // Chat Lock (0027): a locked chat still notifies, but NEVER reveals the
            // sender or a preview — only "New message" (spec §4).
            const { data: lockRow } = await supabase
              .from('locked_conversations').select('conversation_id')
              .eq('conversation_id', m.conversation_id).eq('user_id', me).maybeSingle();
            const isLocked = !!lockRow;
            const sender = await getProfile(supabase, m.sender_id).catch(() => null);
            const convName = (conv as { name?: string | null } | null)?.name ?? 'Group';
            const showPreview = (s ? s.messagePreview : true) && !isLocked;
            const title = isLocked
              ? 'FUTUREHAT'
              : isGroup
                ? `${convName}: ${sender?.display_name ?? 'Someone'}`
                : (sender?.display_name ?? 'FUTUREHAT');
            const body = showPreview ? previewOf(m) : 'New message';
            await presentMessageNotification({ conversationId: m.conversation_id, title, body, isGroup });
          })
          .subscribe();
      }
    })();

    // Taps + action buttons.
    const respSub = Notifications.addNotificationResponseReceivedListener(async (resp) => {
      const data = resp.notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;
      const action = resp.actionIdentifier;
      const userText = (resp as any).userText as string | undefined;
      if (data.type === 'message' && data.conversationId) {
        if (action === 'reply' && userText) {
          await sendMessage(supabase, data.conversationId, userText, 'text').catch(() => {});
          await clearConversationNotification(data.conversationId);
          return;
        }
        if (action === 'mark_read') {
          await markConversationRead(supabase, data.conversationId).catch(() => {});
          await clearConversationNotification(data.conversationId);
          return;
        }
        // Default tap / "open" → open the chat.
        navRef.navigate('Chat' as any, { conversationId: data.conversationId, title: '' });
      } else if (data.type === 'call') {
        // Opening the app surfaces the in-app incoming-call screen (realtime).
        navRef.navigate('Main' as any);
      }
    });

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); respSub.remove(); };
  }, [navRef]);

  return null;
}

function previewOf(m: Message): string {
  if (m.type === 'text') return m.content || 'Message';
  const map: Record<string, string> = {
    image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', voice: '🎤 Voice message',
    file: '📎 Document', gif: 'GIF', sticker: 'Sticker',
  };
  return map[m.type] ?? 'New message';
}
