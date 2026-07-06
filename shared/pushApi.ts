// FUTUREHAT — push notification transport. Registers this device's FCM token so
// the `push` Edge Function can deliver notifications when the app is killed, and
// exposes sendPush() which the sender calls after a message/call so a killed
// recipient still gets notified. All best-effort: if FCM (google-services.json)
// or the Edge Function isn't configured yet, these no-op gracefully.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID, PushKind } from './types.js';

export async function registerPushToken(
  client: SupabaseClient, token: string, platform: 'android' | 'ios' | 'web' = 'android',
): Promise<void> {
  if (!token) return;
  try { await client.rpc('register_push_token', { p_token: token, p_platform: platform }); }
  catch { /* ignore — table/RPC may predate the migration */ }
}

export async function removePushToken(client: SupabaseClient, token: string): Promise<void> {
  if (!token) return;
  try { await client.rpc('remove_push_token', { p_token: token }); }
  catch { /* ignore */ }
}

export interface SendPushArgs {
  conversationId: UUID;
  kind: PushKind;                 // 'message' | 'group' | 'call' | 'missed_call' | 'status' | 'system'
  title: string;
  body: string;
  data?: Record<string, string>;  // extra payload (e.g. callId, type)
}

// Fire-and-forget: invoke the `push` Edge Function to fan the notification out to
// the conversation's other members' registered devices. Never throws.
export async function sendPush(client: SupabaseClient, args: SendPushArgs): Promise<void> {
  try {
    await client.functions.invoke('push', {
      body: {
        conversationId: args.conversationId,
        kind: args.kind,
        title: args.title,
        body: args.body,
        data: args.data ?? {},
      },
    });
  } catch { /* Edge Function not deployed / FCM not configured — ignore */ }
}
