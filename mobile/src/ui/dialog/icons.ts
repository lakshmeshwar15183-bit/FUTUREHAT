// Map semantic dialog icons → Ionicons names (compact outline style).
import type { DialogIconName } from './types';

export function ioniconFor(
  icon: DialogIconName | undefined,
): keyof typeof import('@expo/vector-icons').Ionicons.glyphMap | null {
  switch (icon) {
    case 'trash':
      return 'trash-outline';
    case 'warning':
    case 'alert':
      return 'alert-circle-outline';
    case 'success':
    case 'check':
      return 'checkmark-circle-outline';
    case 'info':
      return 'information-circle-outline';
    case 'block':
      return 'ban-outline';
    case 'logout':
      return 'log-out-outline';
    case 'group':
      return 'people-outline';
    case 'photo':
      return 'image-outline';
    case 'video':
      return 'videocam-outline';
    case 'file':
      return 'document-outline';
    case 'lock':
      return 'lock-closed-outline';
    case 'report':
      return 'flag-outline';
    case 'exit':
      return 'exit-outline';
    case 'person':
      return 'person-outline';
    case 'settings':
      return 'settings-outline';
    case 'search':
      return 'search-outline';
    case 'star':
      return 'star-outline';
    case 'mute':
      return 'notifications-off-outline';
    case 'unmute':
      return 'notifications-outline';
    case 'wallpaper':
      return 'image-outline';
    case 'export':
      return 'share-outline';
    case 'clear':
      return 'brush-outline';
    case 'forward':
      return 'arrow-redo-outline';
    case 'reply':
      return 'arrow-undo-outline';
    case 'copy':
      return 'copy-outline';
    case 'select':
      return 'checkbox-outline';
    case 'edit':
      return 'create-outline';
    case 'pin':
      return 'pin-outline';
    case 'first':
      return 'arrow-up-outline';
    case 'link':
      return 'link-outline';
    case 'none':
    default:
      return null;
  }
}

/** Infer icon from title/message keywords when not provided. */
export function inferIcon(title: string, tone?: string): DialogIconName {
  const t = `${title}`.toLowerCase();
  if (tone === 'danger' || /delete|remove|discard|clear|leave|exit|logout|ban|unsend/.test(t)) return 'trash';
  if (tone === 'success' || /success|saved|done|welcome|enabled|reported/.test(t)) return 'success';
  if (tone === 'warning' || /warning|sure|continue|cancel subscription/.test(t)) return 'warning';
  if (/block|unblock/.test(t)) return 'block';
  if (/report/.test(t)) return 'report';
  if (/group|community|member/.test(t)) return 'group';
  if (/photo|image|gallery|camera/.test(t)) return 'photo';
  if (/video/.test(t)) return 'video';
  if (/file|document|upload/.test(t)) return 'file';
  if (/lock|pin|password|security/.test(t)) return 'lock';
  if (/logout|sign out/.test(t)) return 'logout';
  if (/error|could not|failed|unavailable/.test(t)) return 'alert';
  return 'info';
}
