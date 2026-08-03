-- Lumixo — performance indexes.
-- Every index below was verified against the real schema (0001–0034): the table
-- and every referenced column exist, and none duplicates an index already created
-- by an earlier migration. Kept deliberately small — the base schema is already
-- well-indexed (messages by conversation+time, participants by user, statuses by
-- user+time, streaks by both users, etc.), so this only fills genuine gaps.

-- Full-text search over message bodies. No FTS index existed before; this powers
-- the in-app message search (content is the text/caption column on messages).
create index if not exists idx_messages_content_fts
  on public.messages using gin (to_tsvector('english', coalesce(content, '')));

-- Channel lookup by its backing conversation. Only channels(community_id) existed;
-- resolving "which channel backs this conversation" had no index.
create index if not exists idx_channels_conversation
  on public.channels (conversation_id);

-- A user's own receipts. The PK is (message_id, user_id) — leading column is
-- message_id — so scans keyed on user_id alone were unindexed.
create index if not exists idx_message_receipts_user
  on public.message_receipts (user_id);

-- Reply threading: find replies to a given message. Partial (most messages are
-- not replies) keeps it tiny.
create index if not exists idx_messages_reply_to
  on public.messages (reply_to)
  where reply_to is not null;

-- Call history by initiator. calls(conversation_id) and calls(started_at) existed,
-- but "calls this user started" did not. Note the column is caller_id, not initiator_id.
create index if not exists idx_calls_caller
  on public.calls (caller_id, started_at desc);

-- "Messages from sender X in conversation Y" (moderation / per-member views).
-- Complements idx_messages_conversation (which omits sender_id).
create index if not exists idx_messages_conv_sender
  on public.messages (conversation_id, sender_id, created_at desc);
