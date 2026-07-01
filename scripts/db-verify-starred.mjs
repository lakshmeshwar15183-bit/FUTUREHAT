import { Client } from 'pg';
const REF = 'toscljrivrawvlfebdzz';
const c = new Client({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com', port: 5432,
  user: `postgres.${REF}`, password: process.env.DBPASS, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
await c.connect();
let fail = 0; const ok = (b, m) => { console.log(`${b ? '✅' : '❌'} ${m}`); if (!b) fail++; };

// 1) function exists + granted to authenticated
const fn = (await c.query(`select p.proname, p.prosecdef,
  has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_starred_messages'`)).rows[0];
ok(!!fn, 'function public.get_starred_messages exists');
ok(fn?.prosecdef === true, 'is SECURITY DEFINER');
ok(fn?.auth_exec === true, 'authenticated has EXECUTE');

// 2) anon/no-auth call returns 0 rows (auth.uid() is null) — safe, no leak
const anon = (await c.query('select count(*)::int n from public.get_starred_messages()')).rows[0].n;
ok(anon === 0, `no-auth call returns 0 rows (got ${anon}) — cannot leak others' stars`);

// 3) functional: pick a user who actually has stars, impersonate, expect rows
const starrer = (await c.query(`select user_id, count(*)::int n from public.starred_messages
  group by user_id order by n desc limit 1`)).rows[0];
if (!starrer) {
  console.log('ℹ no user has starred any message yet — seeding a temp star to prove the join, then rolling back');
  await c.query('begin');
  const u = (await c.query('select id from auth.users limit 1')).rows[0]?.id;
  const m = (await c.query(`select mm.id from public.messages mm
     join public.conversation_participants cp on cp.conversation_id=mm.conversation_id and cp.user_id=$1
     where not mm.is_deleted limit 1`, [u])).rows[0]?.id;
  if (u && m) {
    await c.query('insert into public.starred_messages(user_id,message_id) values ($1,$2) on conflict do nothing', [u, m]);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u, role: 'authenticated' })]);
    const rows = (await c.query('select * from public.get_starred_messages()')).rows;
    ok(rows.length >= 1, `impersonated user sees their starred message (rows: ${rows.length})`);
    console.log('   sample:', JSON.stringify({ title: rows[0]?.conversation_title, sender: rows[0]?.sender_name, type: rows[0]?.type, content: (rows[0]?.content ?? '').slice(0, 40) }));
  } else { console.log('⚠ could not seed (no eligible user/message) — join not exercised'); }
  await c.query('rollback');
} else {
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: starrer.user_id, role: 'authenticated' })]);
  const rows = (await c.query('select * from public.get_starred_messages()')).rows;
  await c.query('rollback');
  ok(rows.length >= 1, `user with ${starrer.n} star(s) sees them via RPC (rows: ${rows.length})`);
  console.log('   sample:', JSON.stringify({ title: rows[0]?.conversation_title, sender: rows[0]?.sender_name, type: rows[0]?.type, starred_at: rows[0]?.starred_at }));
}

await c.end();
console.log(`\n${fail === 0 ? 'STARRED RPC VERIFIED ✅' : `${fail} FAILED ❌`}`);
process.exit(fail === 0 ? 0 : 4);
