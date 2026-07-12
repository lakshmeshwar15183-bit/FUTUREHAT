// Lumixo — push notification transport. Registers this device's FCM token so
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
  kind: PushKind;                 // 'message' | 'group' | 'call' | 'missed_call' | 'status' | 'system' | 'mention'
  title: string;
  body: string;
  data?: Record<string, string>;  // extra payload (e.g. callId, messageId, type)
}

/**
 * Fire-and-forget: invoke the `push` Edge Function to fan the notification out
 * to other members' registered devices (FCM). Also drains the push_outbox so
 * DB-triggered jobs flush even if this process dies next.
 *
 * Never throws. Killed-app delivery depends on:
 *   1) recipient FCM token in device_push_tokens
 *   2) Edge Function secret FCM_SERVICE_ACCOUNT
 *   3) this call and/or the 1-minute outbox drain cron
 *
 * Pass data.messageId / data.callId for dedupe. Empty title is OK — the Edge
 * Function rebuilds titles from profiles (avoids tray showing "New message").
 */
export async function sendPush(client: SupabaseClient, args: SendPushArgs): Promise<void> {
  try {
    await client.functions.invoke('push', {
      body: {
        conversationId: args.conversationId,
        kind: args.kind,
        title: args.title ?? '',
        body: args.body ?? '',
        data: args.data ?? {},
        // Clients only fan out their own event. Global outbox drain is reserved
        // for service-role cron (drainPushOutbox) to prevent authenticated abuse.
        drainOutbox: false,
        limit: 1,
      },
    });
  } catch { /* Edge Function not deployed / FCM not configured — ignore */ }
}

/**
 * Kick the server push outbox without sending a new notification.
 * Prefer service-role / scheduled cron. Client calls are best-effort and may be
 * rate-limited server-side; do not rely on every client for global drain.
 */
export async function drainPushOutbox(client: SupabaseClient, limit = 40): Promise<void> {
  try {
    await client.functions.invoke('push', { body: { drainOutbox: true, limit } });
  } catch { /* ignore */ }
}

/**
 * WhatsApp multi-device: after reading a chat, silently clear the tray notification
 * on the user's *other* devices (and this one if a remote FCM is still pending).
 */
export async function clearRemoteChatNotification(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<void> {
  if (!conversationId) return;
  try {
    await client.functions.invoke('push', {
      body: {
        conversationId,
        kind: 'system',
        title: '',
        body: '',
        data: {
          type: 'clear_chat',
          silent: '1',
          conversationId,
        },
        // Self-device fan-out only (handled specially in the Edge Function).
        clearSelfDevices: true,
        drainOutbox: false,
      },
    });
  } catch { /* ignore */ }
}
