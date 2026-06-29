// FUTUREHAT+ — central premium feature registry.
//
// This is the single source of truth for every premium capability. The upgrade
// page, feature gates, and settings all read from here, so adding a new premium
// feature is a one-line change. `status` keeps the product honest:
//   'live' — fully functional today and enforced by a gate
//   'soon' — registered + gated, scaffolding ready to expand
//
// `key` values are referenced by gates via featureEnabled()/useGate().

export type FeatureStatus = 'live' | 'soon';

export type FeatureCategory =
  | 'customization'
  | 'stickers'
  | 'ai'
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
  stickers: { label: 'Stickers & Emoji', icon: '😀' },
  ai: { label: 'AI Features', icon: '🤖' },
  messaging: { label: 'Messaging', icon: '💬' },
  privacy: { label: 'Privacy', icon: '🔒' },
  storage: { label: 'Storage', icon: '📁' },
  identity: { label: 'Premium Identity', icon: '⭐' },
};

export const PREMIUM_FEATURES: PremiumFeature[] = [
  // 🎨 Customization
  { key: 'themes', category: 'customization', title: 'Premium themes', description: 'Unlock a palette of rich, hand-crafted color themes.', icon: '🎨', status: 'live' },
  { key: 'wallpapers', category: 'customization', title: 'Animated wallpapers', description: 'Set animated and gradient chat backgrounds.', icon: '🌌', status: 'live' },
  { key: 'bubbles', category: 'customization', title: 'Custom chat bubbles', description: 'Choose bubble shapes — rounded, sharp, or minimal.', icon: '💠', status: 'live' },
  { key: 'app_icons', category: 'customization', title: 'Premium app icons', description: 'Switch the app icon and browser tab badge.', icon: '🔆', status: 'live' },
  { key: 'fonts', category: 'customization', title: 'Multiple font styles', description: 'Pick from premium reading fonts across the app.', icon: '🔤', status: 'live' },

  // 😀 Stickers & Emoji
  { key: 'emoji_packs', category: 'stickers', title: 'Premium emoji packs', description: 'Extra reaction emoji unlocked in the picker.', icon: '😎', status: 'live' },
  { key: 'sticker_packs', category: 'stickers', title: 'Premium sticker packs', description: 'Send curated premium sticker packs.', icon: '🧩', status: 'live' },
  { key: 'animated_stickers', category: 'stickers', title: 'Animated stickers', description: 'Bring conversations to life with motion stickers.', icon: '✨', status: 'soon' },
  { key: 'ai_stickers', category: 'stickers', title: 'AI sticker creator', description: 'Generate custom stickers from a prompt.', icon: '🪄', status: 'soon' },

  // 🤖 AI
  { key: 'ai_rewrite', category: 'ai', title: 'AI message rewrite', description: 'Rephrase your draft — polished, friendly, or concise.', icon: '📝', status: 'live' },
  { key: 'ai_translate', category: 'ai', title: 'AI translation', description: 'Translate any message into your language.', icon: '🌐', status: 'live' },
  { key: 'ai_summarize', category: 'ai', title: 'AI chat summaries', description: 'Summarize long conversations in one tap.', icon: '📋', status: 'live' },
  { key: 'ai_smart_reply', category: 'ai', title: 'Smart reply suggestions', description: 'Get instant suggested replies in context.', icon: '⚡', status: 'live' },
  { key: 'ai_assistant', category: 'ai', title: 'AI writing assistant', description: 'Compose messages from a short instruction.', icon: '🤖', status: 'live' },

  // 💬 Messaging
  { key: 'schedule', category: 'messaging', title: 'Schedule messages', description: 'Write now, deliver later — automatically.', icon: '⏰', status: 'live' },
  { key: 'pin_unlimited', category: 'messaging', title: 'Pin unlimited chats', description: 'Free pins are limited; premium pins are unlimited.', icon: '📌', status: 'live' },
  { key: 'reminders', category: 'messaging', title: 'Reminder messages', description: 'Schedule a private reminder to yourself.', icon: '🔔', status: 'live' },
  { key: 'edit_history', category: 'messaging', title: 'Longer edit history', description: 'Keep a longer window of message edits.', icon: '🕓', status: 'soon' },
  { key: 'auto_replies', category: 'messaging', title: 'Auto replies', description: 'Set automatic replies when you are away.', icon: '💤', status: 'soon' },

  // 🔒 Privacy
  { key: 'app_lock', category: 'privacy', title: 'App lock (Face ID / PIN)', description: 'Lock the app behind a PIN or device biometrics.', icon: '🔐', status: 'live' },
  { key: 'hide_chats', category: 'privacy', title: 'Hide chats', description: 'Tuck private conversations out of the list.', icon: '🙈', status: 'live' },
  { key: 'ghost_mode', category: 'privacy', title: 'Ghost mode', description: 'Read and type without sending receipts or typing.', icon: '👻', status: 'live' },
  { key: 'advanced_privacy', category: 'privacy', title: 'Advanced privacy', description: 'Fine-grained control over what others can see.', icon: '🛡️', status: 'soon' },

  // 📁 Storage
  { key: 'upload_limits', category: 'storage', title: 'Higher upload limits', description: 'Send larger photos and files.', icon: '⬆️', status: 'live' },
  { key: 'cloud_backup', category: 'storage', title: 'Larger cloud backup', description: 'More room for your chat backups.', icon: '☁️', status: 'soon' },
  { key: 'media_manager', category: 'storage', title: 'Better media management', description: 'Browse and clean up shared media easily.', icon: '🗂️', status: 'soon' },

  // ⭐ Premium identity
  { key: 'badge', category: 'identity', title: 'FUTUREHAT+ badge', description: 'Show a premium badge next to your name.', icon: '✦', status: 'live' },
  { key: 'profile_decor', category: 'identity', title: 'Profile decorations', description: 'Premium accents on your profile.', icon: '💎', status: 'live' },
  { key: 'early_access', category: 'identity', title: 'Early access', description: 'Try new features before everyone else.', icon: '🚀', status: 'live' },
];

// Free-tier limits that premium lifts. Centralized so gates stay consistent.
export const FREE_LIMITS = {
  pinnedChats: 3,
  uploadBytes: 5 * 1024 * 1024, // 5 MB on free, lifted for premium
};

export const PREMIUM_LIMITS = {
  pinnedChats: Infinity,
  uploadBytes: 100 * 1024 * 1024, // 100 MB
};
