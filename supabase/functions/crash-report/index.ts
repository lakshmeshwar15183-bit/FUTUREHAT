// Lumixo — production crash ingest (P0 observability without Sentry).
//
// POST /functions/v1/crash-report
// Body: { kind, label, message, stack, platform, platformVersion, version, ... }
// Auth: optional user JWT (stores user_id when present). Also accepts anon key.
//
// Deploy: supabase functions deploy crash-report --project-ref toscljrivrawvlfebdzz

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const hits = new Map<string, { n: number; t: number }>();

function allow(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now - cur.t > RATE_WINDOW_MS) {
    hits.set(ip, { n: 1, t: now });
    return true;
  }
  if (cur.n >= RATE_MAX) return false;
  cur.n += 1;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!allow(ip)) return json({ error: 'rate limited' }, 429);

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';

    let userId: string | null = null;
    if (authHeader) {
      try {
        const asUser = createClient(SUPABASE_URL, ANON, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data } = await asUser.auth.getUser();
        userId = data.user?.id ?? null;
      } catch {
        /* anonymous crash ok */
      }
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const label = String(body.label ?? body.kind ?? 'unknown').slice(0, 120);
    const message = String(body.message ?? '').slice(0, 800);
    const stack = String(body.stack ?? '').slice(0, 6000);
    const platform = body.platform != null ? String(body.platform).slice(0, 40) : null;
    const platformVer =
      body.platformVersion != null ? String(body.platformVersion).slice(0, 40) : null;
    const appVersion = body.version != null ? String(body.version).slice(0, 40) : null;

    if (!message && !stack && label === 'unknown') {
      return json({ error: 'empty payload' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { error } = await admin.from('crash_reports').insert({
      user_id: userId,
      platform,
      platform_ver: platformVer,
      app_version: appVersion,
      label,
      message: message || null,
      stack: stack || null,
      meta: {
        kind: body.kind ?? null,
        at: body.at ?? null,
      },
    });

    if (error) {
      console.error('[crash-report]', error.message);
      return json({ error: 'store failed' }, 500);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error('[crash-report]', e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
