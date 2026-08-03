// Lumixo — push fan-out Edge Function (Deno).
//
// Production contract (WhatsApp-class):
//   • High-priority FCM for messages; MAX channel for calls
//   • collapse_key + android.notification.tag → one tray entry per chat
//   • claim_push_dedupe → client sendPush + outbox never double-deliver
//   • Silent data cancel for call hangup (no ghost rings)
//   • Prune UNREGISTERED tokens
//   • Mute / locked / preview-off respected per recipient
//
// Deploy:  supabase functions deploy push
// Secret:  supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('PUSH_CORS_ORIGINS') ??
    'https://futurehat-app.netlify.app,https://lumixo.app,http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0] ?? 'https://futurehat-app.netlify.app';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

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
  drainOutbox?: boolean;
  limit?: number;
  /** When true (clear_chat), fan only to the authenticated user's devices. */
  clearSelfDevices?: boolean;
}

interface Prefs {
  messageMute?: boolean;
  messagePreview?: boolean;
  groupMute?: boolean;
  statusMute?: boolean;
  groupVibrate?: boolean;
  messageVibrate?: boolean;
}

let _req: Request | null = null;

Deno.serve(async (req) => {
  _req = req;
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
    let skippedDup = 0;

    // ── Multi-device clear tray (reader's other devices) ─────────────────────
    if (body.clearSelfDevices && body.data?.type === 'clear_chat' && senderId && body.conversationId) {
      const n = await fanOutSelfDevices(admin, accessToken, sa.project_id, {
        userId: senderId,
        conversationId: body.conversationId,
      });
      delivered += n;
      return json({ delivered, failed: 0, skippedDup: 0 }, 200);
    }

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

      const data = body.data ?? {};
      // clear_chat without clearSelfDevices flag still treated as silent cancel.
      const dedupeKey =
        data.type === 'clear_chat'
          ? `clear:${body.conversationId}:${senderId ?? 'x'}:${Date.now()}`
          : buildDedupeKey(body.kind, data);

      const result = await fanOut(admin, accessToken, sa.project_id, {
        conversationId: body.conversationId,
        kind: body.kind,
        title: body.title ?? 'Lumixo',
        body: body.body ?? 'New notification',
        data,
        senderId,
        dedupeKey: data.type === 'clear_chat' ? null : dedupeKey,
      });
      delivered += result.delivered;
      skippedDup += result.skippedDup;

      // Client already sent → mark matching outbox rows delivered so drain won't re-send.
      if (dedupeKey && result.delivered > 0 && data.type !== 'clear_chat') {
        await admin.rpc('mark_push_dedupe_delivered', { p_dedupe_key: dedupeKey }).catch(() => {});
      }
    }

    // ── Outbox drain ────────────────────────────────────────────────────────
    // SECURITY: global claim_push_outbox uses service_role. Never let an
    // end-user JWT drain everyone's outbox (resource abuse / interference).
    // Drain only for:
    //   • Cron / ops with CRON_SECRET (or PUSH_DRAIN_SECRET) header match
    //   • Or the caller is service_role (no end-user sub)
    // Clients fan out their own event only (drainOutbox:false).
    const drainSecret =
      Deno.env.get('CRON_SECRET') ?? Deno.env.get('PUSH_DRAIN_SECRET') ?? '';
    const providedSecret =
      req.headers.get('x-cron-secret') ?? req.headers.get('x-push-drain-secret') ?? '';
    const isServiceCaller =
      // service_role JWT has role claim service_role and typically no useful sub abuse
      (user as { role?: string } | null)?.role === 'service_role' ||
      // When Authorization is service key, getUser() may be null — allow drain only
      // if no user AND apikey is service (checked via missing user + drainSecret).
      false;
    const secretOk =
      !!drainSecret &&
      providedSecret.length > 0 &&
      providedSecret === drainSecret;
    // Default: authenticated users NEVER drain global outbox.
    // Auto-drain when kind omitted was an abuse vector — removed.
    const shouldDrain = secretOk || isServiceCaller
      ? !!body.drainOutbox || (!body.kind && secretOk)
      : false;
    if (shouldDrain) {
      const { data: jobs, error: claimErr } = await admin.rpc('claim_push_outbox', {
        p_limit: body.limit ?? 40,
      });
      if (claimErr) console.warn('[push] claim_push_outbox', claimErr.message);
      for (const job of (jobs ?? []) as any[]) {
        try {
          const data = flattenData(job.data);
          const dedupeKey =
            (typeof job.dedupe_key === 'string' && job.dedupe_key) ||
            buildDedupeKey(job.kind, data);
          const result = await fanOut(admin, accessToken, sa.project_id, {
            conversationId: job.conversation_id,
            kind: job.kind,
            title: job.title,
            body: job.body,
            data,
            senderId: job.sender_id,
            dedupeKey,
          });
          delivered += result.delivered;
          skippedDup += result.skippedDup;
          // Complete when FCM delivered, prior dedupe won, muted-all, or no recipients.
          // Incomplete (zero FCM with tokens) leaves the row for backoff retry.
          if (result.complete || result.delivered > 0 || result.skippedDup > 0) {
            await admin.rpc('mark_push_delivered', { p_id: job.id, p_error: null });
          } else {
            await admin.rpc('mark_push_delivered', {
              p_id: job.id,
              p_error: 'fcm_zero_delivery_will_retry',
            });
            failed++;
          }
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

    return json({ delivered, failed, skippedDup }, 200);
  } catch (e) {
    console.error('[push] error', e);
    return json({ error: String(e) }, 200);
  }
});

function buildDedupeKey(kind: string, data: Record<string, string>): string | null {
  if (data.messageId) return `msg:${data.messageId}`;
  if (data.callId) {
    const t = data.type || kind;
    if (t === 'call_status') return `call:${data.callId}:cancel:${data.status || 'x'}`;
    if (kind === 'missed_call' || t === 'missed_call') return `call:${data.callId}:missed`;
    if (kind === 'call' || t === 'call') return `call:${data.callId}:ring`;
    return `call:${data.callId}:${t}`;
  }
  return null;
}

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
    dedupeKey: string | null;
  },
): Promise<{ delivered: number; skippedDup: number; complete: boolean }> {
  // Global idempotency: first fan-out for this logical event wins.
  // CRITICAL: if we claim but deliver 0 (no tokens / FCM fail), we MUST release
  // the claim so the outbox drain can retry — otherwise killed-app notifs die forever.
  if (job.dedupeKey) {
    const { data: claimed, error } = await admin.rpc('claim_push_dedupe', {
      p_key: job.dedupeKey,
    });
    if (error) {
      // If RPC missing (migration not applied), proceed without dedupe.
      console.warn('[push] claim_push_dedupe', error.message);
    } else if (claimed === false) {
      return { delivered: 0, skippedDup: 1, complete: true };
    }
  }

  const releaseDedupe = async () => {
    if (!job.dedupeKey) return;
    try {
      await admin.rpc('release_push_dedupe', { p_key: job.dedupeKey });
    } catch {
      try {
        await admin.from('push_sent_dedupe').delete().eq('key', job.dedupeKey);
      } catch { /* ignore */ }
    }
  };

  const { data: members } = await admin
    .from('conversation_participants')
    .select('user_id')
    .eq('conversation_id', job.conversationId);

  let recipientIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (job.senderId) {
    recipientIds = recipientIds.filter((id) => id !== job.senderId);
  }
  if (recipientIds.length === 0) {
    // No recipients (e.g. solo) — complete, keep claim.
    return { delivered: 0, skippedDup: 0, complete: true };
  }

  const { data: tokenRows } = await admin
    .from('device_push_tokens')
    .select('token, platform, user_id')
    .in('user_id', recipientIds);
  const tokens = (tokenRows ?? []) as { token: string; platform: string; user_id: string }[];
  if (tokens.length === 0) {
    await releaseDedupe();
    return { delivered: 0, skippedDup: 0, complete: false };
  }

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
      admin.from('conversations').select('type, name, avatar_url').eq('id', job.conversationId).maybeSingle(),
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
  const senderAvatar =
    (senderProfile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  const isGroup = ((conv as { type?: string } | null)?.type ?? 'direct') === 'group';
  const convName = (conv as { name?: string | null } | null)?.name ?? 'Group';
  const convAvatar = (conv as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  // Prefer conversation avatar for groups; sender avatar for 1:1 (FCM large image).
  const imageUrl = isGroup ? convAvatar || senderAvatar : senderAvatar;

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const channelId = CHANNEL[job.kind] ?? 'messages';
  const isCall = job.kind === 'call' || job.kind === 'missed_call';
  const isCallCancel = job.data?.type === 'call_status';
  const isClearChat = job.data?.type === 'clear_chat';

  let delivered = 0;
  let mutedSkips = 0;
  const stale: string[] = [];

  await Promise.all(
    tokens.map(async (t) => {
      const p = prefsByUser.get(t.user_id) ?? {};

      if (!isCall && !isCallCancel && !isClearChat) {
        if (mutedUsers.has(t.user_id)) {
          mutedSkips++;
          return;
        }
        if ((job.kind === 'group' || job.kind === 'mention') && p.groupMute) {
          mutedSkips++;
          return;
        }
        if (job.kind === 'message' && p.messageMute) {
          mutedSkips++;
          return;
        }
        if (job.kind === 'status' && p.statusMute) {
          mutedSkips++;
          return;
        }
      }

      const locked = lockedUsers.has(t.user_id);
      const previewOff =
        (job.kind === 'message' || job.kind === 'group' || job.kind === 'mention') &&
        p.messagePreview === false;
      const isMsgKind =
        job.kind === 'message' || job.kind === 'group' || job.kind === 'mention';
      // Client sendPush often races with "New message" as title — always rebuild
      // from server profile/conversation so killed-app tray looks WhatsApp-class.
      const genericTitle = !job.title || /^(new message|lumixo|message)$/i.test(job.title.trim());

      let title: string;
      let bodyText: string;
      if (isClearChat) {
        title = 'Read';
        bodyText = '';
      } else if (isCallCancel) {
        // Same Android `tag` as the ring replaces the tray entry when the app is
        // killed (data-only silent cancels cannot remove a system notification).
        const st = (job.data?.status || '').toLowerCase();
        title = st === 'missed' ? 'Missed call' : 'Call ended';
        bodyText =
          st === 'missed'
            ? job.title && !genericTitle
              ? job.title
              : senderName
            : '';
      } else if (isCall || job.kind === 'status' || job.kind === 'missed_call') {
        title = job.title || senderName || 'Lumixo';
        bodyText = job.body || '';
      } else if (job.kind === 'system') {
        title = job.title || 'Lumixo';
        bodyText = job.body || '';
      } else if (locked) {
        title = 'Lumixo';
        bodyText = 'New message';
      } else if (isGroup || job.kind === 'mention') {
        title = convName;
        bodyText = previewOff
          ? 'New message'
          : job.body?.includes(':')
            ? job.body
            : `${senderName}: ${job.body || 'New message'}`;
      } else if (isMsgKind) {
        title = genericTitle ? senderName : job.title;
        bodyText = previewOff ? 'New message' : job.body || 'New message';
      } else {
        title = job.title || senderName || 'Lumixo';
        bodyText = job.body || 'New message';
      }

      const data: Record<string, string> = {
        type: isClearChat
          ? 'clear_chat'
          : isCallCancel
            ? 'call_status'
            : job.kind === 'missed_call'
              ? 'missed_call'
              : job.kind === 'call'
                ? 'call'
                : job.kind === 'mention'
                  ? 'mention'
                  : job.kind === 'status'
                    ? 'status_reply'
                    : 'message',
        kind: job.kind,
        conversationId: job.conversationId,
        ...(job.data ?? {}),
      };
      if (imageUrl && !isClearChat) data.avatarUrl = imageUrl;
      if (senderName && !isClearChat) data.senderName = senderName;

      const tag =
        isCall || isCallCancel
          ? `call:${data.callId ?? job.conversationId}`
          : `chat:${job.conversationId}`;

      // collapse_key groups concurrent FCM deliveries for the same chat on Android.
      const collapseKey = isCall || isCallCancel ? tag : `chat:${job.conversationId}`;

      // clear_chat: data-only (multi-device read).
      // call / call_status: DATA-ONLY high priority so Android always delivers to
      // LumixoFirebaseMessagingService when killed → native full-screen CallStyle.
      // messages: notification+data for system tray when process is dead.
      const callDataOnly = isCall || isCallCancel;
      const message = isClearChat
        ? {
            message: {
              token: t.token,
              data: { ...data, silent: '1', title: title || '', body: bodyText || '' },
              android: {
                priority: 'high',
                ttl: '60s',
                collapse_key: collapseKey,
              },
              apns: {
                headers: {
                  'apns-priority': '10',
                  'apns-push-type': 'background',
                  'apns-collapse-id': collapseKey,
                },
                payload: { aps: { 'content-available': 1 } },
              },
            },
          }
        : callDataOnly
          ? {
              message: {
                token: t.token,
                // No `notification` block — ensures onMessageReceived when killed.
                data: {
                  ...data,
                  title: title || 'Incoming call',
                  body: bodyText || (isCallCancel ? 'Call ended' : 'Incoming call'),
                  silent: isCallCancel ? '1' : '0',
                  sentAt: String(Date.now()),
                },
                android: {
                  priority: 'high',
                  ttl: isCallCancel ? '30s' : '60s',
                  collapse_key: collapseKey,
                  direct_boot_ok: true,
                },
                apns: {
                  headers: {
                    'apns-priority': '10',
                    'apns-collapse-id': collapseKey,
                    'apns-push-type': isCallCancel ? 'background' : 'alert',
                    'apns-expiration': String(Math.floor(Date.now() / 1000) + 60),
                  },
                  payload: {
                    aps: isCallCancel
                      ? { 'content-available': 1 }
                      : {
                          alert: {
                            title: title || 'Incoming call',
                            body: bodyText || 'Incoming call',
                          },
                          sound: 'default',
                          'interruption-level': 'time-sensitive',
                          'thread-id': job.conversationId,
                        },
                  },
                },
              },
            }
          : {
              message: {
                token: t.token,
                notification: {
                  title: title || 'Lumixo',
                  body: bodyText || 'New notification',
                },
                data: {
                  ...data,
                  // Latency probe: server enqueue/send time (ms since epoch).
                  sentAt: String(Date.now()),
                },
                android: {
                  priority: 'high',
                  ttl: '86400s',
                  collapse_key: collapseKey,
                  direct_boot_ok: true,
                  notification: {
                    channel_id: channelId,
                    sound: 'default',
                    tag,
                    notification_priority: 'PRIORITY_HIGH',
                    default_vibrate_timings: true,
                    visibility: 'PUBLIC',
                    ...(imageUrl && /^https:\/\//i.test(imageUrl) ? { image: imageUrl } : {}),
                  },
                },
                apns: {
                  headers: {
                    'apns-priority': '10',
                    'apns-collapse-id': collapseKey,
                    'apns-push-type': 'alert',
                  },
                  payload: {
                    aps: {
                      sound: 'default',
                      'thread-id': job.conversationId,
                      'mutable-content': 1,
                      'interruption-level': 'active',
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
      // Only prune truly dead tokens — INVALID_ARGUMENT can be payload shape.
      if (resp.status === 404 || /UNREGISTERED|NOT_FOUND|Requested entity was not found/i.test(errText)) {
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

  // All recipients intentionally muted → done (do not retry forever).
  if (delivered === 0 && mutedSkips === tokens.length && tokens.length > 0) {
    return { delivered: 0, skippedDup: 0, complete: true };
  }

  // Zero FCM success with tokens that should have received → release for retry.
  if (delivered === 0) {
    await releaseDedupe();
    return { delivered: 0, skippedDup: 0, complete: false };
  }

  return { delivered, skippedDup: 0, complete: true };
}

/** Silent clear for multi-device read sync — only the authenticated user's tokens. */
async function fanOutSelfDevices(
  admin: ReturnType<typeof createClient>,
  accessToken: string,
  projectId: string,
  args: { userId: string; conversationId: string },
): Promise<number> {
  const { data: tokenRows } = await admin
    .from('device_push_tokens')
    .select('token')
    .eq('user_id', args.userId);
  const tokens = (tokenRows ?? []) as { token: string }[];
  if (!tokens.length) return 0;

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const collapseKey = `chat:${args.conversationId}`;
  let delivered = 0;
  const stale: string[] = [];

  await Promise.all(
    tokens.map(async (t) => {
      const payload = {
        message: {
          token: t.token,
          data: {
            type: 'clear_chat',
            silent: '1',
            conversationId: args.conversationId,
          },
          android: { priority: 'high', ttl: '60s', collapse_key: collapseKey },
          apns: {
            headers: {
              'apns-priority': '10',
              'apns-push-type': 'background',
              'apns-collapse-id': collapseKey,
            },
            payload: { aps: { 'content-available': 1 } },
          },
        },
      };
      const resp = await fetch(fcmUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        delivered++;
        return;
      }
      const errText = await resp.text().catch(() => '');
      if (resp.status === 404 || /UNREGISTERED|NOT_FOUND|Requested entity was not found/i.test(errText)) {
        stale.push(t.token);
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
  const base = _req
    ? corsHeaders(_req)
    : {
        'Access-Control-Allow-Origin': 'https://futurehat-app.netlify.app',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...base, 'content-type': 'application/json' },
  });
}
