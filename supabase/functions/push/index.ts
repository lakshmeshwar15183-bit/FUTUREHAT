// Lumixo — push fan-out Edge Function (Deno).
//
// Paths:
//   1) Client invoke (JWT): send one notification for a conversation (legacy).
//   2) Drain outbox (service role / cron): claim_push_outbox → FCM for each job.
//
// FCM uses high-priority Android messages with channel routing that matches
// mobile/src/lib/notifications.ts. Calls use full-screen-intent style tags.
//
// Deploy:  supabase functions deploy push
// Secret:  supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CHANNEL: Record<string, string> = {
  message: 'messages',
  group: 'group_messages',
  call: 'calls',
  missed_call: 'missed_calls',
  status: 'status_replies',
  system: 'admin_system',
  mention: 'mentions',
};

interface Body {
  conversationId?: string;
  kind?: 'message' | 'group' | 'call' | 'missed_call' | 'status' | 'system' | 'mention';
  title?: string;
  body?: string;
  data?: Record<string, string>;
  /** When true (service role), drain push_outbox instead of a single fan-out. */
  drainOutbox?: boolean;
  limit?: number;
}

interface Prefs {
  messageMute?: boolean;
  messagePreview?: boolean;
  groupMute?: boolean;
  statusMute?: boolean;
  groupVibrate?: boolean;
  messageVibrate?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const rawKey = Deno.env.get('FCM_SERVICE_ACCOUNT');

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const isService = !!SERVICE && token === SERVICE;

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    // Auth: service role OR signed-in user.
    let senderId: string | null = null;
    if (!isService) {
      const asCaller = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await asCaller.auth.getUser();
      const sender = userData.user;
      if (!sender) return json({ error: 'Unauthorized' }, 401);
      senderId = sender.id;
    } else {
      senderId = body.data?.senderId ?? null;
    }

    if (!rawKey) {
      return json({ skipped: 'push-not-configured', delivered: 0 }, 200);
    }

    const sa = JSON.parse(rawKey) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    const accessToken = await getAccessToken(sa);

    let delivered = 0;
    let failed = 0;

    // ── Single fan-out (client sendPush) ────────────────────────────────────
    if (body.conversationId && body.kind) {
      if (!isService && senderId) {
        const { data: membership } = await admin
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', body.conversationId)
          .eq('user_id', senderId)
          .maybeSingle();
        if (!membership) return json({ error: 'Not a member' }, 403);
      }

      delivered += await fanOut(admin, accessToken, sa.project_id, {
        conversationId: body.conversationId,
        kind: body.kind,
        title: body.title ?? 'Lumixo',
        body: body.body ?? 'New notification',
        data: body.data ?? {},
        senderId,
      });
    }

    // ── Outbox drain (always when requested, or when no single job) ─────────
    const shouldDrain = !!body.drainOutbox || !body.kind;
    if (shouldDrain) {
      const { data: jobs, error: claimErr } = await admin.rpc('claim_push_outbox', {
        p_limit: body.limit ?? 40,
      });
      if (claimErr) console.warn('[push] claim_push_outbox', claimErr.message);
      for (const job of (jobs ?? []) as any[]) {
        try {
          const n = await fanOut(admin, accessToken, sa.project_id, {
            conversationId: job.conversation_id,
            kind: job.kind,
            title: job.title,
            body: job.body,
            data: flattenData(job.data),
            senderId: job.sender_id,
          });
          delivered += n;
          await admin.rpc('mark_push_delivered', { p_id: job.id, p_error: null });
        } catch (e) {
          failed++;
          await admin.rpc('mark_push_delivered', {
            p_id: job.id,
            p_error: String(e).slice(0, 400),
          });
        }
      }
    }

    if (!body.conversationId && !shouldDrain) {
      return json({ error: 'Bad request' }, 400);
    }

    return json({ delivered, failed }, 200);
  } catch (e) {
    console.error('[push] error', e);
    return json({ error: String(e) }, 200);
  }
});

async function fanOut(
  admin: ReturnType<typeof createClient>,
  accessToken: string,
  projectId: string,
  job: {
    conversationId: string;
    kind: string;
    title: string;
    body: string;
    data: Record<string, string>;
    senderId: string | null;
  },
): Promise<number> {
  const { data: members } = await admin
    .from('conversation_participants')
    .select('user_id')
    .eq('conversation_id', job.conversationId);

  let recipientIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (job.senderId) {
    recipientIds = recipientIds.filter((id) => id !== job.senderId);
  }
  if (recipientIds.length === 0) return 0;

  const { data: tokenRows } = await admin
    .from('device_push_tokens')
    .select('token, platform, user_id')
    .in('user_id', recipientIds);
  const tokens = (tokenRows ?? []) as { token: string; platform: string; user_id: string }[];
  if (tokens.length === 0) return 0;

  const [{ data: prefRows }, { data: lockRows }, { data: mutedRows }, { data: senderProfile }, { data: conv }] =
    await Promise.all([
      admin.from('user_preferences').select('user_id, extra').in('user_id', recipientIds),
      admin
        .from('locked_conversations')
        .select('user_id')
        .eq('conversation_id', job.conversationId)
        .in('user_id', recipientIds),
      admin
        .from('muted_conversations')
        .select('user_id, muted_until')
        .eq('conversation_id', job.conversationId)
        .in('user_id', recipientIds),
      job.senderId
        ? admin.from('profiles').select('display_name, avatar_url').eq('id', job.senderId).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('conversations').select('type, name').eq('id', job.conversationId).maybeSingle(),
    ]);

  const prefsByUser = new Map<string, Prefs>();
  for (const r of (prefRows ?? []) as { user_id: string; extra: any }[]) {
    prefsByUser.set(r.user_id, (r.extra?.notifications ?? {}) as Prefs);
  }
  const lockedUsers = new Set((lockRows ?? []).map((r: { user_id: string }) => r.user_id));
  const now = Date.now();
  const mutedUsers = new Set(
    (mutedRows ?? [])
      .filter((r: any) => !r.muted_until || new Date(r.muted_until).getTime() > now)
      .map((r: any) => r.user_id as string),
  );

  const senderName =
    (senderProfile as { display_name?: string } | null)?.display_name ?? 'Lumixo';
  const isGroup = ((conv as { type?: string } | null)?.type ?? 'direct') === 'group';
  const convName = (conv as { name?: string | null } | null)?.name ?? 'Group';

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const channelId = CHANNEL[job.kind] ?? 'messages';
  const isCall = job.kind === 'call' || job.kind === 'missed_call';
  const isCallCancel = job.data?.type === 'call_status';

  let delivered = 0;
  const stale: string[] = [];

  await Promise.all(
    tokens.map(async (t) => {
      const p = prefsByUser.get(t.user_id) ?? {};

      // Mute: calls always ring; chat mute skips messages.
      if (!isCall && !isCallCancel) {
        if (mutedUsers.has(t.user_id)) return;
        if (job.kind === 'group' && p.groupMute) return;
        if (job.kind === 'message' && p.messageMute) return;
        if (job.kind === 'status' && p.statusMute) return;
      }

      const locked = lockedUsers.has(t.user_id);
      const previewOff = (job.kind === 'message' || job.kind === 'group') && p.messagePreview === false;

      let title: string;
      let bodyText: string;
      if (isCallCancel) {
        // Silent cancel for ringing devices
        title = 'Call ended';
        bodyText = '';
      } else if (isCall || job.kind === 'system' || job.kind === 'status' || job.kind === 'missed_call') {
        title = job.title || 'Lumixo';
        bodyText = job.body || '';
      } else if (locked) {
        title = 'Lumixo';
        bodyText = 'New message';
      } else if (isGroup) {
        title = job.title?.includes(':') ? job.title : `${convName}`;
        bodyText = previewOff ? 'New message' : job.body || 'New message';
        if (!job.title?.includes(':') && senderName) {
          title = convName;
          bodyText = previewOff ? 'New message' : `${senderName}: ${job.body || 'New message'}`;
        }
      } else {
        title = job.title || senderName;
        bodyText = previewOff ? 'New message' : job.body || 'New message';
      }

      const data: Record<string, string> = {
        type: isCall || isCallCancel ? (job.data?.type || 'call') : job.kind === 'missed_call' ? 'missed_call' : 'message',
        kind: job.kind,
        conversationId: job.conversationId,
        ...(job.data ?? {}),
      };

      const tag = isCall || isCallCancel
        ? `call:${data.callId ?? job.conversationId}`
        : `chat:${job.conversationId}`;

      // Call cancel: data-only high priority so the app can dismiss the ring UI.
      const message =
        isCallCancel
          ? {
              message: {
                token: t.token,
                data: { ...data, silent: '1' },
                android: {
                  priority: 'high',
                  ttl: '30s',
                },
                apns: {
                  headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
                  payload: { aps: { 'content-available': 1 } },
                },
              },
            }
          : {
              message: {
                token: t.token,
                notification: { title, body: bodyText },
                data,
                android: {
                  priority: 'high',
                  ttl: isCall ? '60s' : '86400s',
                  notification: {
                    channel_id: channelId,
                    sound: 'default',
                    tag,
                    notification_priority: isCall ? 'PRIORITY_MAX' : 'PRIORITY_HIGH',
                    default_vibrate_timings: true,
                    visibility: 'PUBLIC',
                    ...(isCall
                      ? {
                          // Android call-style presentation when supported.
                        }
                      : {}),
                  },
                },
                apns: {
                  headers: {
                    'apns-priority': '10',
                    ...(isCall ? { 'apns-push-type': 'alert' } : {}),
                  },
                  payload: {
                    aps: {
                      sound: 'default',
                      'thread-id': job.conversationId,
                      badge: 1,
                      ...(isCall ? { 'interruption-level': 'time-sensitive' } : {}),
                    },
                  },
                },
              },
            };

      const resp = await fetch(fcmUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(message),
      });
      if (resp.ok) {
        delivered++;
        return;
      }
      const errText = await resp.text().catch(() => '');
      if (resp.status === 404 || /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(errText)) {
        stale.push(t.token);
      } else {
        console.warn(
          `[push] FCM ${resp.status} for …${t.token.slice(-6)}: ${errText.slice(0, 200)}`,
        );
      }
    }),
  );

  if (stale.length) {
    try {
      await admin.from('device_push_tokens').delete().in('token', stale);
    } catch { /* ignore */ }
  }

  return delivered;
}

function flattenData(d: unknown): Record<string, string> {
  if (!d || typeof d !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

// ── FCM v1 OAuth ─────────────────────────────────────────────────────────────
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(sa: {
  client_email: string;
  private_key: string;
}): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > nowSec) return cachedToken.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(claim)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!resp.ok) throw new Error(`FCM token exchange failed: ${resp.status} ${await resp.text()}`);
  const j = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, exp: nowSec + (j.expires_in ?? 3600) };
  return j.access_token;
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
