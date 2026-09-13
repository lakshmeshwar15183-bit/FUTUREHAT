// Lumixo — TURN config fetcher (authenticated)
// Returns TURN relay credentials from Edge secrets, NOT from client env.
// Clients (web/mobile) fetch at call start so credentials can be rotated
// without app update and never appear in the JS bundle / git.
//
// Deploy: supabase functions deploy turn-config
// Secrets: supabase secrets set TURN_URL="turn:turn.example.com:443?transport=tcp,turn:turn.example.com:80" TURN_USERNAME="user" TURN_CREDENTIAL="pass"
//           supabase secrets set TURN_URL="turn:global.relay.metered.ca:443,..."  // legacy_metered rotation
//
// Auth: requires valid user JWT (prevents anonymous TURN harvesting).
// GET/POST both work; POST is preferred for Supabase JS `functions.invoke`.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('PUSH_CORS_ORIGINS') ??
    'https://futurehat-app.netlify.app,https://lumixo.app,http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0] ?? 'https://futurehat-app.netlify.app';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(req) });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...cors(req), 'content-type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const asUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: authErr } = await asUser.auth.getUser();
    if (authErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors(req), 'content-type': 'application/json' },
      });
    }

    const TURN_URL = Deno.env.get('TURN_URL') ?? '';
    const TURN_USERNAME = Deno.env.get('TURN_USERNAME') ?? '';
    const TURN_CREDENTIAL = Deno.env.get('TURN_CREDENTIAL') ?? '';

    if (!TURN_URL || !TURN_USERNAME || !TURN_CREDENTIAL) {
      return new Response(
        JSON.stringify({
          configured: false,
          iceServers: null,
          message: 'TURN not configured — STUN only. Set TURN_* secrets for reliable cross-network calls.',
        }),
        { status: 200, headers: { ...cors(req), 'content-type': 'application/json' } },
      );
    }

    // Parse comma-separated TURN URLs (managed providers give multiple transports)
    const urls = TURN_URL.split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    return new Response(
      JSON.stringify({
        configured: true,
        iceServers: [{ urls, username: TURN_USERNAME, credential: TURN_CREDENTIAL }],
      }),
      { status: 200, headers: { ...cors(req), 'content-type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }), {
      status: 500,
      headers: { ...cors(req), 'content-type': 'application/json' },
    });
  }
});
