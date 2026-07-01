// FUTUREHAT — shared domain types (mirror the Postgres schema in supabase/migrations)

export type UUID = string;

export type ConversationType = 'direct' | 'group';
export type MessageType = 'text' | 'image' | 'file' | 'audio';
export type ReceiptStatus = 'delivered' | 'read';
export type ParticipantRole = 'member' | 'admin';

export interface Profile {
  id: UUID;
  phone: string | null;
  username: string | null;
  display_name: string | null;
  about: string | null;
  avatar_url: string | null;
  last_seen: string | null;
  created_at: string;
}

export interface Conversation {
  id: UUID;
  type: ConversationType;
  name: string | null;
  avatar_url: string | null;
  created_by: UUID | null;
  created_at: string;
}

export interface ConversationParticipant {
  conversation_id: UUID;
  user_id: UUID;
  role: ParticipantRole;
  joined_at: string;
}

export interface Message {
  id: UUID;
  conversation_id: UUID;
  sender_id: UUID;
  type: MessageType;
  content: string | null;
  media_url: string | null;
  reply_to: UUID | null;
  is_deleted: boolean;
  created_at: string;
  edited_at: string | null;
  /** Set when this message was forwarded from another chat (see 0011). Optional
   *  so the field is safe before the migration is applied. */
  is_forwarded?: boolean | null;
  /** Client-only: this is an optimistic/queued message not yet confirmed by the
   *  server (offline outbox). Never persisted server-side. */
  pending?: boolean;
}

export interface MessageReceipt {
  message_id: UUID;
  user_id: UUID;
  status: ReceiptStatus;
  updated_at: string;
}

export interface MessageReaction {
  message_id: UUID;
  user_id: UUID;
  emoji: string;
  created_at: string;
}

// One row from get_starred_messages() (0014): a starred message enriched with
// sender + conversation context so it can be browsed outside its chat.
export interface StarredMessage {
  message_id: UUID;
  conversation_id: UUID;
  sender_id: UUID;
  type: MessageType;
  content: string | null;
  media_url: string | null;
  created_at: string;
  starred_at: string;
  sender_name: string | null;
  sender_avatar: string | null;
  conversation_type: ConversationType;
  conversation_title: string | null;
}

// View-model: a conversation enriched with its other participant(s) + last message
export interface ConversationSummary {
  conversation: Conversation;
  participants: Profile[];
  lastMessage: Message | null;
  unreadCount: number;
  title: string;
  avatarUrl: string | null;
}

// ── Premium (FUTUREHAT+) ──────────────────────────────────────────────────────

export type PlanId = 'monthly' | 'yearly';
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'past_due';
export type PaymentProviderId = 'razorpay' | 'stripe' | 'manual';

export interface Subscription {
  user_id: UUID;
  plan: PlanId;
  status: SubscriptionStatus;
  provider: PaymentProviderId;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  amount_inr: number | null;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  user_id: UUID;
  theme: string;
  font: string;
  bubble_style: string;
  wallpaper: string;
  app_icon: string;
  ghost_mode: boolean;
  app_lock: boolean;
  extra: Record<string, unknown>;
  updated_at: string;
}

export interface ScheduledMessage {
  id: UUID;
  conversation_id: UUID;
  sender_id: UUID;
  type: MessageType;
  content: string | null;
  media_url: string | null;
  send_at: string;
  sent: boolean;
  created_at: string;
}

export type StatusType = 'image' | 'text' | 'video';

export interface Status {
  id: UUID;
  user_id: UUID;
  type: StatusType;
  content: string | null;
  media_url: string | null;
  background: string | null;
  created_at: string;
  expires_at: string;
  // Joined author profile (display_name + avatar_url), best-effort.
  profile?: { id: UUID; display_name: string | null; avatar_url: string | null } | null;
}

// A single viewer of a status (for the "seen by" list on your own status).
export interface StatusViewer {
  viewer_id: UUID;
  viewed_at: string;
  profile?: { id: UUID; display_name: string | null; avatar_url: string | null } | null;
}

// ── Calling ───────────────────────────────────────────────────────────────────

export type CallType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended';

export interface Call {
  id: UUID;
  conversation_id: UUID;
  caller_id: UUID;
  type: CallType;
  status: CallStatus;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  // Admin call-metric columns (0013). Optional so the type is safe before the
  // migration is applied and for clients that don't record them.
  connection_state?: string | null;
  ice_failures?: number | null;
  reconnects?: number | null;
  turn_used?: boolean | null;
  failure_reason?: string | null;
}

// ── Owner / Admin management (0013) ─────────────────────────────────────────────

/** Platform authority tiers. `owner` is the immutable developer allowlist (0005)
 *  and can never be assigned via the client — only user/moderator/admin are. */
export type PlatformRole = 'user' | 'moderator' | 'admin' | 'owner';
export type AccountStatus = 'active' | 'suspended' | 'banned' | 'disabled' | 'locked';
export type PremiumDuration = '1m' | '3m' | '6m' | '1y' | 'lifetime' | 'custom';
export type AnnouncementKind = 'announcement' | 'maintenance' | 'update' | 'force_update';

/** Known feature-flag keys seeded by 0013. Strings are allowed too (forward-compat). */
export type FeatureFlagKey =
  | 'stories' | 'communities' | 'channels' | 'calls' | 'video_calls'
  | 'voice_notes' | 'premium' | 'ai_features' | 'payments' | 'notifications'
  | 'app_enabled';

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  label: string | null;
  updated_at: string;
  updated_by: UUID | null;
}

export interface Announcement {
  id: UUID;
  kind: AnnouncementKind;
  title: string;
  body: string | null;
  active: boolean;
  created_by: UUID | null;
  created_at: string;
}

export interface Device {
  id: UUID;
  user_id: UUID;
  device_id: string;
  name: string | null;
  platform: string | null;
  last_seen: string;
  created_at: string;
}

/** One row in the admin user-search result. */
export interface AdminUserSummary {
  id: UUID;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  role: PlatformRole;
  account_status: AccountStatus;
  verified: boolean;
  last_seen: string | null;
  created_at: string;
  suspended_until: string | null;
  deleted_at: string | null;
  premium: boolean;
  owner: boolean;
}

/** Full profile returned by admin_get_user. */
export interface AdminUserDetail extends AdminUserSummary {
  about: string | null;
  status_reason: string | null;
  verified_at: string | null;
  banned_at: string | null;
  force_logout_at: string | null;
  subscription: Subscription | null;
  devices: Device[];
  recent_security: Array<{ kind: string; ip: string | null; user_agent: string | null; created_at: string }>;
}

export interface AuditEntry {
  id: UUID;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  actor_id: UUID | null;
  actor_email: string | null;
}

export interface AdminStats {
  users: number; messages: number; conversations: number; communities: number;
  statuses: number; premium_users: number; open_reports: number; open_tickets: number;
  online_users: number; dau: number; mau: number; new_today: number;
  banned_users: number; total_calls: number; failed_calls: number; channels: number;
}

export interface AdminCallStats {
  active_audio: number; active_video: number; ringing: number; failed: number;
  ice_failures: number; reconnects: number; turn_calls: number; avg_duration_s: number;
  recent: Call[];
}

export interface AdminMessageStats {
  total: number; deleted: number; delivered: number; read: number;
  scheduled_pending: number; undelivered: number;
}

export interface AdminDbHealth {
  database: string; latency_ms: number; now: string; profiles: number;
  oldest_pending_scheduled: string | null; pending_deletions: number;
}

export interface AdminGlobalSearch {
  users: AdminUserSummary[];
  communities: Array<{ id: UUID; name: string; description: string | null; owner_id: UUID; created_at: string }>;
  channels: Array<{ id: UUID; name: string; kind: string; community_id: UUID }>;
  messages: Array<{ id: UUID; conversation_id: UUID; sender_id: UUID; type: string; content: string | null; created_at: string }>;
  reports: Array<{ id: UUID; target_type: string; target_id: UUID; reason: string; status: string; created_at: string }>;
}
