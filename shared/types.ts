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

export interface Status {
  id: UUID;
  user_id: UUID;
  type: 'image' | 'text';
  content: string | null;
  media_url: string | null;
  background: string | null;
  created_at: string;
  expires_at: string;
}
