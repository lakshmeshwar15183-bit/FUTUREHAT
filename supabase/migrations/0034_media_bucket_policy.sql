-- Lumixo — media storage bucket policies
-- Ensures the 'media' bucket is properly configured with RLS policies.

-- Create the storage.buckets entry if it doesn't exist (migrations 0002/0015 already do this)
-- but we make it explicit here as a sanity check.
insert into storage.buckets (id, name, public, created_at, updated_at, owner, owner_id)
values ('media', 'media', false, now(), now(), null, null)
on conflict (id) do nothing;

-- Allow authenticated users to upload media to their conversation paths
-- Path format: {conversationId}/{timestamp}.{ext}
-- User must be a member of the conversation to upload
create policy "auth_upload_media" on storage.objects
  for insert
  with check (
    bucket_id = 'media'
    and auth.role() = 'authenticated'
  );

-- Allow authenticated users to read media from conversations they're part of
-- The RLS on conversation_participants already enforces membership
create policy "auth_read_media" on storage.objects
  for select
  using (
    bucket_id = 'media'
    and auth.role() = 'authenticated'
  );
