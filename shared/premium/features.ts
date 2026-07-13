// Lumixo+ — central premium feature registry.
//
// Single source of truth for premium capability. Upgrade page, gates, and
// settings read from here. Keep the list honest:
//   'live' — fully functional today and enforced by a gate
//   'soon' — registered only; not shown as sold benefits
//
// Free tier should feel WhatsApp-class for everyday chat (including uploads).
// Premium extends limits and unlocks extras — it does not gate basic file send.

export type FeatureStatus = 'live' | 'soon';

export type FeatureCategory =
  | 'customization'
  | 'stickers'
  | 'messaging'
  | 'privacy'
  | 'storage'
  | 'identity';

export interface PremiumFeature {
  key: string;
  category: FeatureCategory;
  title: string;
  description: string;
  icon: string;
  status: FeatureStatus;
}

export const FEATURE_CATEGORIES: Record<
  FeatureCategory,
  { label: string; icon: string }
> = {
  customization: { label: 'Customization', icon: '🎨' },
  stickers: { label: 'Stickers', icon: '😀' },
  messaging: { label: 'Messaging', icon: '💬' },
  privacy: { label: 'Privacy', icon: '🔒' },
  storage: { label: 'Storage', icon: '📁' },
  identity: { label: 'Premium Identity', icon: '⭐' },
};

export const PREMIUM_FEATURES: PremiumFeature[] = [
  // 🎨 Customization
  {
    key: 'themes',
    category: 'customization',
    title: 'Premium themes',
    description: 'Unlock a palette of rich, hand-crafted color themes.',
    icon: '🎨',
    status: 'live',
  },
  {
    key: 'wallpapers',
    category: 'customization',
    title: 'Chat wallpapers',
    description: 'Set gradient and styled chat backgrounds.',
    icon: '🌌',
    status: 'live',
  },
  {
    key: 'bubbles',
    category: 'customization',
    title: 'Custom chat bubbles',
    description: 'Choose bubble shapes — rounded, sharp, or minimal.',
    icon: '💠',
    status: 'live',
  },
  {
    key: 'app_icons',
    category: 'customization',
    title: 'Premium app icons',
    description: 'Switch the app icon on your home screen.',
    icon: '🔆',
    status: 'live',
  },
  {
    key: 'fonts',
    category: 'customization',
    title: 'Multiple font styles',
    description: 'Pick from premium reading fonts across the app.',
    icon: '🔤',
    status: 'live',
  },

  // 😀 Stickers (base packs are free; premium can expand later)
  {
    key: 'sticker_packs',
    category: 'stickers',
    title: 'Extra sticker packs',
    description: 'More sticker packs beyond the free defaults.',
    icon: '🧩',
    status: 'soon',
  },
  {
    key: 'animated_stickers',
    category: 'stickers',
    title: 'Animated stickers',
    description: 'Motion stickers for livelier chats.',
    icon: '✨',
    status: 'soon',
  },

  // 💬 Messaging
  {
    key: 'schedule',
    category: 'messaging',
    title: 'Schedule messages',
    description: 'Write now, deliver later — automatically.',
    icon: '⏰',
    status: 'live',
  },
  {
    key: 'pin_unlimited',
    category: 'messaging',
    title: 'Pin unlimited chats',
    description: 'Free accounts pin a few chats; premium pins are unlimited.',
    icon: '📌',
    status: 'live',
  },
  {
    key: 'reminders',
    category: 'messaging',
    title: 'Reminder messages',
    description: 'Schedule a private reminder to yourself.',
    icon: '🔔',
    status: 'live',
  },
  {
    key: 'edit_history',
    category: 'messaging',
    title: 'Longer edit history',
    description: 'Keep a longer window of message edits.',
    icon: '🕓',
    status: 'soon',
  },
  {
    key: 'auto_replies',
    category: 'messaging',
    title: 'Auto replies',
    description: 'Set automatic replies when you are away.',
    icon: '💤',
    status: 'soon',
  },

  // 🔒 Privacy
  {
    key: 'app_lock',
    category: 'privacy',
    title: 'App lock (Face ID / PIN)',
    description: 'Lock the app behind a PIN or device biometrics.',
    icon: '🔐',
    status: 'live',
  },
  {
    key: 'hide_chats',
    category: 'privacy',
    title: 'Hide chats',
    description: 'Tuck private conversations out of the list.',
    icon: '🙈',
    status: 'live',
  },
  {
    key: 'ghost_mode',
    category: 'privacy',
    title: 'Ghost mode',
    description: 'Read and type without sending receipts or typing.',
    icon: '👻',
    status: 'live',
  },
  {
    key: 'advanced_privacy',
    category: 'privacy',
    title: 'Advanced privacy',
    description: 'Fine-grained control over what others can see.',
    icon: '🛡️',
    status: 'soon',
  },

  // 📁 Storage — free is WhatsApp-class; premium extends the ceiling
  {
    key: 'upload_limits',
    category: 'storage',
    title: 'Larger file uploads',
    description:
      'Free sends everyday files like WhatsApp (up to 100 MB). Lumixo+ raises the limit to 2 GB.',
    icon: '⬆️',
    status: 'live',
  },
  {
    key: 'cloud_backup',
    category: 'storage',
    title: 'Larger cloud backup',
    description: 'More room for your chat backups.',
    icon: '☁️',
    status: 'soon',
  },
  {
    key: 'media_manager',
    category: 'storage',
    title: 'Better media management',
    description: 'Browse and clean up shared media easily.',
    icon: '🗂️',
    status: 'soon',
  },

  // ⭐ Premium identity
  {
    key: 'badge',
    category: 'identity',
    title: 'Lumixo+ badge',
    description: 'Show a premium badge next to your name.',
    icon: '✦',
    status: 'live',
  },
  {
    key: 'profile_decor',
    category: 'identity',
    title: 'Profile decorations',
    description: 'Premium accents on your profile.',
    icon: '💎',
    status: 'live',
  },
  {
    key: 'early_access',
    category: 'identity',
    title: 'Early access',
    description: 'Try new features before everyone else.',
    icon: '🚀',
    status: 'live',
  },
];

/**
 * Upload / pin limits.
 *
 * Free uploads are WhatsApp-class for everyday chat (photos, voice, docs).
 * Premium extends the ceiling for large videos and files.
 */
export const FREE_LIMITS = {
  pinnedChats: 3,
  /** ~WhatsApp-class everyday media/docs (100 MB). */
  uploadBytes: 100 * 1024 * 1024,
};

export const PREMIUM_LIMITS = {
  pinnedChats: Infinity,
  /** Extended large-file ceiling (2 GB). */
  uploadBytes: 2 * 1024 * 1024 * 1024,
};

/** Absolute server/client hard ceiling (must be ≥ PREMIUM_LIMITS.uploadBytes). */
export const UPLOAD_HARD_CEILING_BYTES = PREMIUM_LIMITS.uploadBytes;
