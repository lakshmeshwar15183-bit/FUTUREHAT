-- Lumixo — Performance optimization: critical indexes and query patterns
-- Adds indexes for common queries to ensure sub-millisecond response times

-- Conversation loading (chat list)
create index if not exists idx_participants_conv_asc on public.conversation_participants(conversation_id, user_id);
create index if not exists idx_messages_conv_time on public.messages(conversation_id, created_at desc);

-- Message receipt tracking (unread counts, read state)
create index if not exists idx_receipts_status on public.message_receipts(status);
create index if not exists idx_receipts_msg_user on public.message_receipts(message_id, user_id, status);

-- Real-time subscriptions (presence, online status)
create index if not exists idx_presence_user on public.presence(user_id) where online = true;

-- Search performance
create index if not exists idx_messages_content on public.messages using gin(to_tsvector('english', content));

-- Streaks queries (quick lookup)
create index if not exists idx_streaks_conv_user on public.streaks(conversation_id, user_id);

-- Community/channel quick lookups
create index if not exists idx_comm_members_user_idx on public.community_members(user_id, role);
create index if not exists idx_channels_conv_idx on public.channels(conversation_id);

-- Status queries (24h window)
create index if not exists idx_statuses_user_created on public.statuses(user_id, created_at desc);

-- Conversation flags (pinned, muted, archived) - these are often queried together
create index if not exists idx_conversation_flags_user on public.conversation_participants(user_id, conversation_id, pinned, muted);

-- Message deletion (for "deleted for me" functionality)
create index if not exists idx_deleted_msgs_user on public.deleted_conversation_messages(user_id, conversation_id);

-- Optimize frequently-joined queries
create index if not exists idx_messages_conversation_sender on public.messages(conversation_id, sender_id, created_at);

-- Presence and online status (common in list views)
create index if not exists idx_user_last_seen on public.profiles(user_id) where last_seen is not null;

-- Call history (for quick recent call lookup)
create index if not exists idx_calls_conversation_created on public.calls(conversation_id, created_at desc);

-- Analyze query plans to ensure indexes are used
analyze public.messages;
analyze public.conversation_participants;
analyze public.message_receipts;
analyze public.profiles;
