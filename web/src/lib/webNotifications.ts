// FUTUREHAT web — browser notifications via the Notification API. Mirrors the
// mobile behaviour: message + call notifications honoring the user's synced
// preferences (mute / preview), permission handling, and click-to-open. The
// sound is the browser/OS default (we never bundle sounds). Click focuses the tab
// and asks the app to open the relevant conversation via a global callback.
import type { NotificationSettings } from '@shared/types';

let openConversationId: string | null = null;
let onOpenChat: ((conversationId: string) => void) | null = null;

/** App registers a handler so a notification click can open the chat. */
export function setNotificationOpenHandler(fn: ((conversationId: string) => void) | null) { onOpenChat = fn; }
/** ChatView reports which chat is open so we don't notify for it while focused. */
export function setOpenConversation(id: string | null) { openConversationId = id; }

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}
export function notificationPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied';
}

/** Request permission (must be user-initiated). Returns whether it's granted. */
export async function ensurePermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; }
  catch { return false; }
}

function canShow(): boolean {
  // Only notify when the tab is hidden/unfocused (WhatsApp Web parity).
  return notificationsSupported() && Notification.permission === 'granted'
    && typeof document !== 'undefined' && document.visibilityState !== 'visible';
}

export interface WebMessageNotif {
  conversationId: string;
  title: string;
  body: string;
  icon?: string | null;
  isGroup?: boolean;
  settings?: NotificationSettings | null;
}

export function showMessageNotification(o: WebMessageNotif): void {
  if (!canShow()) return;
  const s = o.settings;
  if (s && (o.isGroup ? s.groupMute : s.messageMute)) return;
  if (openConversationId === o.conversationId && document.visibilityState === 'visible') return;
  const preview = s ? s.messagePreview : true;
  try {
    const n = new Notification(o.title, {
      body: preview ? o.body : 'New message',
      icon: o.icon || '/favicon.png',
      tag: `chat:${o.conversationId}`,   // collapse repeats per chat (no dupes)
      renotify: true,
    } as NotificationOptions);
    n.onclick = () => { window.focus(); onOpenChat?.(o.conversationId); n.close(); };
  } catch { /* ignore */ }
}

export interface WebCallNotif {
  conversationId: string;
  title: string;
  video?: boolean;
  icon?: string | null;
  settings?: NotificationSettings | null;
}

export function showCallNotification(o: WebCallNotif): void {
  if (!canShow()) return;
  try {
    const n = new Notification(o.title, {
      body: o.video ? 'Incoming video call' : 'Incoming voice call',
      icon: o.icon || '/favicon.png',
      tag: `call:${o.conversationId}`,
      requireInteraction: true,           // keep visible until answered/dismissed
    } as NotificationOptions);
    n.onclick = () => { window.focus(); onOpenChat?.(o.conversationId); n.close(); };
  } catch { /* ignore */ }
}
