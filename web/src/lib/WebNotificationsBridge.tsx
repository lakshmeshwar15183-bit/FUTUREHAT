// Lumixo web — notifications bridge. Mounted once in App. Subscribes to new
// messages (and relies on CallContext for calls) and raises a browser
// notification when the tab is hidden/unfocused, honoring the user's synced
// prefs. Click focuses the tab and opens the chat. No bundled sounds.
import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { getCurrentUser, getProfile } from '@shared/api';
import { type Message } from '@shared/types';
import { getNotificationSettings } from '@shared/notificationsApi';
import type { ConversationSummary, NotificationSettings } from '@shared/types';
import {
  showMessageNotification, setNotificationOpenHandler, setOpenConversation,
} from './webNotifications';

export function WebNotifications({
  conversations, selectedConvId, onOpenChat,
}: {
  conversations: ConversationSummary[];
  selectedConvId: string | null;
  onOpenChat: (conversationId: string) => void;
}) {
  const convRef = useRef(conversations);
  const settingsRef = useRef<NotificationSettings | null>(null);
  const meRef = useRef<string | null>(null);

  useEffect(() => { convRef.current = conversations; }, [conversations]);
  useEffect(() => { setOpenConversation(selectedConvId); }, [selectedConvId]);
  useEffect(() => {
    setNotificationOpenHandler(onOpenChat);
    return () => setNotificationOpenHandler(null);
  }, [onOpenChat]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      meRef.current = (await getCurrentUser(supabase))?.id ?? null;
      settingsRef.current = await getNotificationSettings(supabase).catch(() => null);
    })();

    const channel = supabase
      .channel('web-message-notify')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        if (cancelled) return;
        const m = payload.new as Message;
        const me = meRef.current;
        if (!m || m.sender_id === me || m.is_deleted) return;
        // Only notify for MY conversations (the realtime stream is app-wide).
        const conv = convRef.current.find((c) => c.conversation.id === m.conversation_id);
        if (!conv) return;
        const isGroup = conv.conversation.type === 'group';
        const sender = await getProfile(supabase, m.sender_id).catch(() => null);
        const title = isGroup
          ? `${conv.title}: ${sender?.display_name ?? 'Someone'}`
          : (conv.title || sender?.display_name || 'Lumixo');
        showMessageNotification({
          conversationId: m.conversation_id,
          title,
          body: previewOf(m),
          icon: conv.avatarUrl,
          isGroup,
          settings: settingsRef.current,
        });
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, []);

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
