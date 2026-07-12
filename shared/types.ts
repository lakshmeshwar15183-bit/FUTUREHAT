// Lumixo — shared domain types (mirror the Postgres schema in supabase/migrations)

export type UUID = string;

export type ConversationType = 'direct' | 'group';
// 'system' = WhatsApp-style centered info notice (e.g. disappearing-messages
// turned on/off). System messages never disappear and are not user-editable /
// deletable. Added in migration 0027.
// 'video' is a first-class media type (migration 0031). Older videos may still
// exist as type='file' with a video media_url — treat those as video via
// isVideoUrl() for backward-compat.
export type MessageType = 'text' | 'image' | 'video' | 'file' | 'audio' | 'system';
export type ReceiptStatus = 'delivered' | 'read';
/** Group participant role. `super_admin` = group owner/creator (migration 0037). */
export type ParticipantRole = 'member' | 'admin' | 'super_admin';

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
  /** Disappearing-messages timer (0022): 0 = OFF (default), else 3600..28800
   *  (1–8h). Optional so the type is safe before the migration is applied. */
  disappear_seconds?: number;
  /** Group description (0037). */
  description?: string | null;
  /** WhatsApp-style group permissions (0037). Defaults match WA. */
  only_admins_can_send?: boolean;
  only_admins_can_edit_info?: boolean;
  only_admins_can_add_members?: boolean;
  only_admins_can_pin?: boolean;
  only_admins_manage_disappearing?: boolean;
  approve_new_members?: boolean;
  member_history_visible?: boolean;
}

/** Client view of group permission toggles (0037). */
export interface GroupPermissions {
  onlyAdminsCanSend: boolean;
  onlyAdminsCanEditInfo: boolean;
  onlyAdminsCanAddMembers: boolean;
  onlyAdminsCanPin: boolean;
  onlyAdminsManageDisappearing: boolean;
  approveNewMembers: boolean;
  memberHistoryVisible: boolean;
}

/** Enriched group member row for Group Info UI. */
export interface GroupMember {
  userId: UUID;
  role: ParticipantRole;
  joinedAt: string;
  profile: Profile;
}

/** Pending invite-link join request. */
export interface GroupJoinRequest {
  userId: UUID;
  displayName: string | null;
  avatarUrl: string | null;
  username: string | null;
  createdAt: string;
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
  /** When set (0022), the message auto-disappears at this time. Stamped at INSERT
   *  from the conversation's disappearing timer; NULL when the timer is off.
   *  Optional so the type is safe before the migration is applied. */
  expires_at?: string | null;
  /** Client-only: this is an optimistic/queued message not yet confirmed by the
   *  server (offline outbox). Never persisted server-side. */
  pending?: boolean;
  /** Per-attachment metadata produced by the media picker/editor (0030). Optional
   *  so the type is safe before the migration is applied; old rows read as {}. */
  media_meta?: MediaMeta | null;
}

/** Metadata the media picker/editor attaches to an image/file message (0030). */
export interface MediaMeta {
  /** View Once: recipient may open exactly once; cannot forward/save/export. */
  viewOnce?: boolean;
  /** Uploaded at HD (higher quality tier). */
  hd?: boolean;
  /** Chosen quality tier. */
  quality?: 'standard' | 'hd' | 'original';
  width?: number;
  height?: number;
  /** Video duration in ms (when the attachment is a video). */
  durationMs?: number;
  /** True if the image was edited (crop/draw/text/stickers) before sending. */
  edited?: boolean;
  /** Video trim intent (ms). Recorded by the video editor; the actual cut is applied
   *  by a native transcoder when enabled (Phase C). */
  trimStartMs?: number;
  trimEndMs?: number;
  /** Video audio muted (intent; applied by the transcoder). */
  muted?: boolean;
}

/** Result of mark_view_once_seen() / view_once_state() (0030). */
export interface ViewOnceState {
  view_once: boolean;
  is_sender?: boolean;
  seen?: boolean;
  can_open?: boolean;
  first_view?: boolean;
  consumed?: boolean;
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

// ── Premium (Lumixo+) ──────────────────────────────────────────────────────

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

export type StatusType = 'image' | 'text' | 'video' | 'audio';

// Who may see a status. Enforced server-side (see migration 0021):
//   everyone  — any authenticated user (minus blocked)
//   contacts  — users who share a direct conversation with the author
//   except    — contacts, minus the snapshotted status_audience list
//   only       — only the snapshotted status_audience list
export type StatusAudience = 'everyone' | 'contacts' | 'except' | 'only';

export interface Status {
  id: UUID;
  user_id: UUID;
  type: StatusType;
  content: string | null;
  media_url: string | null;
  background: string | null;
  caption: string | null;       // image/video/audio caption (0021)
  text_color: string | null;    // custom text-status color (0021)
  duration_ms: number | null;   // audio/video length for the viewer (0021)
  audience: StatusAudience;      // privacy audience (0021); defaults to 'everyone'
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

// ── Calls module — history / schedule / settings (0024) ──────────────────────
export type CallDirection = 'incoming' | 'outgoing';

// One enriched row from get_call_history(): the call plus the viewer-relative
// peer (the other 1:1 participant; null for groups) and direction.
export interface CallHistoryItem {
  id: UUID;
  conversation_id: UUID;
  caller_id: UUID;
  type: CallType;
  status: CallStatus;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  direction: CallDirection;
  conversation_type: string | null;
  conversation_name: string | null;
  peer_id: UUID | null;
  peer_username: string | null;
  peer_name: string | null;
  peer_avatar: string | null;
}

// Consecutive same-peer calls collapsed into one WhatsApp-style row ("Name (n)").
export interface CallGroup {
  key: string;                 // conversation_id (stable per peer/chat)
  conversation_id: UUID;
  peer_id: UUID | null;
  title: string;               // peer name / conversation name / fallback
  peer_username: string | null;
  peer_avatar: string | null;
  latest: CallHistoryItem;     // newest call in the group (drives icon/time)
  count: number;               // number of collapsed calls
  callIds: UUID[];             // every call id in the group (for delete)
  anyMissed: boolean;
}

export interface ScheduledCall {
  id: UUID;
  conversation_id: UUID;
  organizer_id: UUID;
  callee_id: UUID | null;
  type: CallType;
  scheduled_at: string;
  title: string | null;
  status: 'scheduled' | 'cancelled' | 'done';
  created_at: string;
}

// Persisted in user_preferences.extra.calls (no new table).
export interface CallSettings {
  silence_unknown: boolean;    // silence calls from people you don't share a chat with
  ringtone: boolean;           // play a ringtone on incoming calls
  vibrate: boolean;            // vibrate on incoming calls
}

// ── Notifications (0025) ─────────────────────────────────────────────────────
// A tone value is 'default' (device system sound) or a content:// URI the user
// explicitly picked in Android's per-channel settings.
export interface NotificationSettings {
  // MESSAGE
  messageMute: boolean;
  messageTone: string;          // 'default' | uri
  messageVibrate: boolean;
  messagePopup: boolean;
  messageHighPriority: boolean;
  messagePreview: boolean;
  // CALLS
  callRingtone: string;         // 'default' | uri
  callVibrate: boolean;
  callFullScreen: boolean;
  callFlash: boolean;
  // STATUS
  statusMute: boolean;
  // GROUPS
  groupTone: string;            // 'default' | uri
  groupVibrate: boolean;
  groupMute: boolean;
}

export type PushKind = 'message' | 'group' | 'call' | 'missed_call' | 'status' | 'system' | 'mention';

// ── Chat Lock (0027) ────────────────────────────────────────────────────────────
// Per-chat lock secured entirely by the DEVICE's own authentication (Android
// BiometricPrompt / iOS LocalAuthentication → biometric, else device PIN/password).
// Lumixo never stores a PIN, password, or biometric — it only records WHICH
// conversations the user chose to lock (locked_conversations) so the choice syncs
// across their devices. Auto-lock timing + the master enable live in
// user_preferences.extra.chatLock so they sync too.

/** Re-lock delay (ms) after leaving a locked chat / backgrounding the app.
 *  0 = immediately on exit. */
export type ChatLockAutoLock = 0 | 60000 | 300000 | 1800000;

export interface ChatLockSettings {
  /** Master switch — when off, locking is not offered and no chat is gated. */
  enabled: boolean;
  /** How long after exit before a revealed locked chat re-locks. */
  autoLockMs: ChatLockAutoLock;
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

// ── Message reporting (0017) ────────────────────────────────────────────────
// Fixed reason vocabulary shared by the mobile picker and the admin dashboard.
export type ReportReason =
  | 'spam' | 'harassment' | 'abuse' | 'fake_information'
  | 'illegal_content' | 'violence' | 'child_safety' | 'other';

export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

// What a report points at (0008). 'message' = reported message; 'user' = reported
// profile. The Moderator Dashboard splits its two sections on this.
export type ReportTargetKind = 'user' | 'message' | 'conversation' | 'channel' | 'community';

// One row from admin_list_reports() — joins reporter + reported-user profiles and
// the (live or snapshotted) message content onto the report.
export interface AdminReport {
  report_id: UUID;
  target_type: ReportTargetKind;
  target_id: UUID;
  message_id: UUID | null;
  conversation_id: UUID | null;
  reporter_id: UUID;
  reported_user_id: UUID | null;
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  escalated: boolean;
  escalated_at: string | null;
  escalated_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: UUID | null;
  message_content: string | null;
  message_exists: boolean;
  reporter_username: string | null;
  reporter_name: string | null;
  reporter_avatar: string | null;
  reported_username: string | null;
  reported_name: string | null;
  reported_avatar: string | null;
  conversation_type: string | null;
  conversation_name: string | null;
}

// ── Moderator system (0023) ─────────────────────────────────────────────────
// Fixed warning-reason vocabulary — kept in sync with the CHECK in issue_warning().
export type WarningReason =
  | 'spam' | 'harassment' | 'fake_profile' | 'hate_speech'
  | 'scam_fraud' | 'inappropriate_content' | 'other';

export const WARNING_REASONS: ReadonlyArray<{ value: WarningReason; label: string }> = [
  { value: 'spam',                  label: 'Spam' },
  { value: 'harassment',            label: 'Harassment' },
  { value: 'fake_profile',          label: 'Fake Profile' },
  { value: 'hate_speech',           label: 'Hate Speech' },
  { value: 'scam_fraud',            label: 'Scam / Fraud' },
  { value: 'inappropriate_content', label: 'Inappropriate Content' },
  { value: 'other',                 label: 'Other' },
];

// Kinds of user-mailbox notification (user_warnings.kind, 0023).
export type MailboxKind = 'warning' | 'mod_appointed' | 'mod_removed' | 'info';

// One row from my_mailbox() — a notification in the user's mailbox.
export interface MailboxItem {
  id: UUID;
  kind: MailboxKind;
  title: string | null;
  reason: WarningReason | string | null;
  message: string | null;
  report_id: UUID | null;
  created_by: UUID | null;
  actor_username: string | null;
  actor_name: string | null;
  seen_at: string | null;
  created_at: string;
}

// One row from admin_moderator_audit() — same shape as AuditEntry.
export type ModeratorAuditEntry = AuditEntry;

export interface AdminConversationView {
  conversation: { id: UUID; type: string; name: string | null; created_at: string } | null;
  participants: Array<{ id: UUID; username: string | null; display_name: string | null; avatar_url: string | null }>;
  messages: Array<{
    id: UUID; sender_id: UUID; type: string; content: string | null; media_url: string | null;
    is_deleted: boolean; created_at: string; edited_at: string | null;
  }>;
}

// ── Streaks (0029) ──────────────────────────────────────────────────────────
// Relationship streaks between the two users of a direct conversation. Scores,
// rewards, roles and milestones are SERVER-AUTHORITATIVE (see supabase/migrations/
// 0029_streaks.sql); the client only ever READS these and mirrors streak_tier().

export type StreakMilestoneKind = 'diamond' | 'mod_eligible' | 'hall_of_legends';

// One of the caller's streaks, from get_my_streaks(). Drives the chat-list emoji.
export interface StreakSummary {
  streak_id: UUID;
  conversation_id: UUID;
  score: number;
  tier: string;                 // emoji derived from score by the DB (mirror below)
  successful_days: number;
  peer_id: UUID;
  peer_username: string | null;
  peer_name: string | null;
  peer_avatar: string | null;
  completed_today: boolean;
  i_qualified_today: boolean;
  peer_qualified_today: boolean;
}

// One score-change ledger row (streak_events) — the Streak History.
export interface StreakEvent {
  day: string | null;
  delta: number;
  old_score: number;
  new_score: number;
  reason: string;               // 'daily_award' | 'missed_penalty' | 'milestone'
  created_at: string;
}

export interface StreakMilestoneRow {
  kind: StreakMilestoneKind;
  achieved_at: string;
  achieved_score: number;
  reward_granted: boolean;
  meta: Record<string, unknown>;
}

// get_streak() detail payload for one pair.
export interface StreakDetail {
  streak: {
    streak_id: UUID;
    conversation_id: UUID;
    score: number;
    tier: string;
    successful_days: number;
    last_awarded_day: string | null;
    created_at: string;
  } | null;
  milestones: StreakMilestoneRow[];
  events: StreakEvent[];
}

// One legendary pair from get_hall_of_legends().
export interface HallOfLegendsEntry {
  streak_id: UUID;
  achieved_at: string;
  achieved_score: number;
  current_score: number;
  current_tier: string;
  user_a_id: UUID; user_a_username: string | null; user_a_name: string | null; user_a_avatar: string | null;
  user_b_id: UUID; user_b_username: string | null; user_b_name: string | null; user_b_avatar: string | null;
}
