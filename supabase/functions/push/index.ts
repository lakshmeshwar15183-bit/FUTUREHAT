// FUTUREHAT — push fan-out Edge Function (Deno). This is the KILLED-STATE delivery
// path: the sender's app calls sendPush() (shared/pushApi.ts) after a message/call;
// this function looks up the recipients' registered FCM device tokens and delivers a
// real push notification via the Firebase Cloud Messaging HTTP v1 API. Because it's a
// remote FCM *notification* message, Android/iOS display it from the system tray even
// when the recipient's app is fully killed — no JS runtime required. The in-app
// realtime WebSocket path (NotificationsBridge) still covers the foreground and is
// disabled per-device once FCM is live, so the two never double-notify.
//
// Security model (mirrors functions/ai):
//   • verify_jwt (default) → only a signed-in user can invoke.
//   • The caller is authenticated with THEIR jwt and must be a member of the
//     conversation, so a user can only push into their own chats.
//   • Cross-user reads (recipient tokens / prefs / lock) use the SERVICE ROLE and
//     stay entirely server-side; the caller never sees another user's data.
//
// Deploy:  supabase functions deploy push
// Secret (required, one JSON blob — the Firebase service-account key):
//   supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
// The service account must have the "Firebase Cloud Messaging API" enabled; project_id
// is read from the key itself. If the secret is missing, the function no-ops (204) so
// messaging keeps working without push configured.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Kind → Android channel id. MUST match CHANNELS in mobile/src/lib/notifications.ts
// so the device routes each push to a channel with the right importance/sound.
const CHANNEL: Record<string, string> = {
  message: 'messages',
  group: 'group_messages',
  call: 'calls',
  missed_call: 'missed_calls',
  status: 'status',
  system: 'admin_system',
};

interface Body {
  conversationId: string;
  kind: 'message' | 'group' | 'call' | 'missed_call' | 'status' | 'system';
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface Prefs {
  messageMute?: boolean; messagePreview?: boolean;
  groupMute?: boolean; statusMute?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1) Identify the caller with THEIR jwt (RLS-scoped).
    const asCaller = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await asCaller.auth.getUser();
    const sender = userData.user;
    if (!sender) return json({ error: 'Unauthorized' }, 401);

    const b = (await req.json()) as Body;
    if (!b?.conversationId || !b?.kind) return json({ error: 'Bad request' }, 400);

    // If push isn't configured yet, succeed quietly — realtime still covers foreground.
    const rawKey = Deno.env.get('FCM_SERVICE_ACCOUNT');
    if (!rawKey) return json({ skipped: 'push-not-configured' }, 200);

    // 2) All cross-user reads go through the service role (bypasses RLS), but only
    //    AFTER we confirm the caller is a member of this conversation.
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    const { data: membership } = await admin
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', b.conversationId)
      .eq('user_id', sender.id)
      .maybeSingle();
    if (!membership) return json({ error: 'Not a member' }, 403);

    // Recipients = other members of the conversation.
    const { data: members } = await admin
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', b.conversationId)
      .neq('user_id', sender.id);
    const recipientIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
    if (recipientIds.length === 0) return json({ delivered: 0 }, 200);

    // Their registered devices (0 or many per user).
    const { data: tokenRows } = await admin
      .from('device_push_tokens')
      .select('token, platform, user_id')
      .in('user_id', recipientIds);
    const tokens = (tokenRows ?? []) as { token: string; platform: string; user_id: string }[];
    if (tokens.length === 0) return json({ delivered: 0 }, 200);

    // Per-recipient notification prefs (mute / preview) + chat-lock state, so
    // redaction matches the in-app realtime path exactly (privacy is the RECIPIENT's).
    const [{ data: prefRows }, { data: lockRows }, { data: senderProfile }, { data: conv }] =
      await Promise.all([
        admin.from('user_preferences').select('user_id, extra').in('user_id', recipientIds),
        admin.from('locked_conversations').select('user_id')
          .eq('conversation_id', b.conversationId).in('user_id', recipientIds),
        admin.from('profiles').select('display_name').eq('id', sender.id).maybeSingle(),
        admin.from('conversations').select('type, name').eq('id', b.conversationId).maybeSingle(),
      ]);

    const prefsByUser = new Map<string, Prefs>();
    for (const r of (prefRows ?? []) as { user_id: string; extra: any }[]) {
      prefsByUser.set(r.user_id, (r.extra?.notifications ?? {}) as Prefs);
    }
    const lockedUsers = new Set((lockRows ?? []).map((r: { user_id: string }) => r.user_id));
    const senderName = (senderProfile as { display_name?: string } | null)?.display_name ?? 'FUTUREHAT';
    const isGroup = ((conv as { type?: string } | null)?.type ?? 'direct') === 'group';
    const convName = (conv as { name?: string | null } | null)?.name ?? 'Group';

    // 3) Mint (or reuse) an FCM v1 OAuth access token from the service account.
    const sa = JSON.parse(rawKey) as { project_id: string; client_email: string; private_key: string };
    const accessToken = await getAccessToken(sa);
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    const channelId = CHANNEL[b.kind] ?? 'messages';
    const isCall = b.kind === 'call' || b.kind === 'missed_call';

    // 4) Build + send one message per token, redacted for that recipient.
    let delivered = 0;
    const stale: string[] = [];
    await Promise.all(tokens.map(async (t) => {
      const p = prefsByUser.get(t.user_id) ?? {};
      // Mute (calls always ring, WhatsApp-style).
      if (!isCall) {
        if (b.kind === 'group' && p.groupMute) return;
        if (b.kind === 'message' && p.messageMute) return;
        if (b.kind === 'status' && p.statusMute) return;
      }
      const locked = lockedUsers.has(t.user_id);
      const previewOff = b.kind === 'message' && p.messagePreview === false;

      let title: string;
      let bodyText: string;
      if (isCall || b.kind === 'system' || b.kind === 'status') {
        title = b.title; bodyText = b.body;
      } else if (locked) {
        title = 'FUTUREHAT'; bodyText = 'New message';           // never reveal a locked chat
      } else if (isGroup) {
        title = `${convName}: ${senderName}`;
        bodyText = previewOff ? 'New message' : (b.body || 'New message');
      } else {
        title = senderName;
        bodyText = previewOff ? 'New message' : (b.body || 'New message');
      }

      // FCM data values MUST be strings. Carry routing info for the tap handler.
      const data: Record<string, string> = {
        type: isCall ? 'call' : 'message',
        kind: b.kind,
        conversationId: b.conversationId,
        ...(b.data ?? {}),
      };

      const message = {
        message: {
          token: t.token,
          notification: { title, body: bodyText },
          data,
          android: {
            priority: 'high',
            notification: {
              channel_id: channelId,
              sound: 'default',
              tag: isCall ? `call:${data.callId ?? b.conversationId}` : `chat:${b.conversationId}`,
            },
          },
          apns: {
            headers: { 'apns-priority': '10' },
            payload: { aps: { sound: 'default', 'thread-id': b.conversationId } },
          },
        },
      };

      const resp = await fetch(fcmUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(message),
      });
      if (resp.ok) { delivered++; return; }

      // Prune tokens FCM says are dead so we stop paying for them / delaying delivery.
      const errText = await resp.text().catch(() => '');
      if (resp.status === 404 || /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(errText)) {
        stale.push(t.token);
      } else {
        console.warn(`[push] FCM ${resp.status} for token …${t.token.slice(-6)}: ${errText.slice(0, 200)}`);
      }
    }));

    if (stale.length) {
      try { await admin.from('device_push_tokens').delete().in('token', stale); } catch { /* best-effort prune */ }
    }

    return json({ delivered, pruned: stale.length }, 200);
  } catch (e) {
    console.error('[push] error', e);
    // Never surface a hard failure to the sender — messaging must not depend on push.
    return json({ error: String(e) }, 200);
  }
});

// ── FCM v1 OAuth: sign a JWT with the service-account key, exchange for an access
// token, cache it in the worker until ~1 min before expiry. ──────────────────────
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const nowSec = Math.floor(nowMs() / 1000);
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
    'pkcs8', pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
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
  const j = await resp.json() as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, exp: nowSec + (j.expires_in ?? 3600) };
  return j.access_token;
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
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

// Date.now indirection keeps the crypto path testable/deterministic if stubbed.
function nowMs(): number { return Date.now(); }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'content-type': 'application/json' },
  });
}
