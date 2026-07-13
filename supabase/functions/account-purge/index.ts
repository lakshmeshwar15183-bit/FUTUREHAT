// Lumixo — process due account deletion requests (GDPR / Play Data Safety).
//
// Call with service role (cron) every day:
//   POST /functions/v1/account-purge
//   Authorization: Bearer <SERVICE_ROLE_KEY>
//   body: { limit: 20 }
//
// Steps per user:
//   1) Mark deletion request completed
//   2) Anonymize profile
//   3) Drop push tokens
//   4) Delete auth user (cascades most rows)
//
// Deploy: supabase functions deploy account-purge

import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!SERVICE || token !== SERVICE) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const limit = Math.min(Math.max(body.limit ?? 20, 1), 100);

    const admin = createClient(SUPABASE_URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: due, error } = await admin
      .from('account_deletion_requests')
      .select('user_id, purge_after')
      .eq('status', 'pending')
      .lte('purge_after', new Date().toISOString())
      .limit(limit);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    let purged = 0;
    const failures: string[] = [];

    for (const row of due ?? []) {
      const uid = row.user_id as string;
      try {
        // Anonymize profile first so any residual references are non-identifying.
        await admin
          .from('profiles')
          .update({
            display_name: 'Deleted user',
            username: `deleted_${uid.slice(0, 8)}`,
            about: null,
            avatar_url: null,
            links: [],
          })
          .eq('id', uid);

        await admin.from('device_push_tokens').delete().eq('user_id', uid);

        await admin
          .from('account_deletion_requests')
          .update({ status: 'completed' })
          .eq('user_id', uid);

        const { error: delErr } = await admin.auth.admin.deleteUser(uid);
        if (delErr) {
          failures.push(`${uid}: ${delErr.message}`);
          continue;
        }
        purged++;
      } catch (e) {
        failures.push(`${uid}: ${String(e)}`);
      }
    }

    return new Response(JSON.stringify({ purged, failures, scanned: (due ?? []).length }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
