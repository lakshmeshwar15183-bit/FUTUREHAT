import { Client } from 'pg';
const REF = 'toscljrivrawvlfebdzz';
const c = new Client({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com', port: 5432,
  user: `postgres.${REF}`, password: process.env.DBPASS, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
await c.connect();
let fail = 0;
const ok = (b, msg) => { console.log(`${b ? '✅' : '❌'} ${msg}`); if (!b) fail++; };

const EXPECTED_FUNCS = ['_audit','_guard_owner_target','_require_admin','_require_moderator_or_admin','_require_owner','admin_audit_log','admin_call_stats','admin_community_remove_member','admin_db_health','admin_delete_account','admin_delete_channel','admin_delete_community','admin_delete_conversation','admin_delete_message','admin_delete_status','admin_edit_community','admin_force_logout','admin_get_user','admin_global_search','admin_grant_premium','admin_message_stats','admin_remove_device','admin_revoke_premium','admin_search_users','admin_send_announcement','admin_set_account_status','admin_set_app_enabled','admin_set_feature_flag','admin_set_role','admin_stats','admin_transfer_community','admin_verify_user','is_account_active','is_admin','is_moderator','is_owner'];
const EXPECTED_TABLES = ['announcements','devices','feature_flags'];

// 1) Functions
const fns = (await c.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows.map(r => r.proname);
const fset = new Set(fns);
const missingFns = EXPECTED_FUNCS.filter(f => !fset.has(f));
ok(missingFns.length === 0, `Functions present: ${EXPECTED_FUNCS.length - missingFns.length}/${EXPECTED_FUNCS.length}` + (missingFns.length ? ` — MISSING: ${missingFns.join(', ')}` : ''));

// 2) Tables + RLS enabled
for (const t of EXPECTED_TABLES) {
  const r = (await c.query(`select c.relrowsecurity rls, (select count(*) from pg_policy p where p.polrelid=c.oid) npol
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [t])).rows[0];
  ok(!!r, `Table public.${t} exists` + (r ? ` (RLS ${r.rls ? 'ON' : 'OFF'}, ${r.npol} policies)` : ''));
}

// 3) Added columns
const colCheck = async (tbl, cols) => {
  const have = (await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [tbl])).rows.map(r => r.column_name);
  const hs = new Set(have);
  const miss = cols.filter(x => !hs.has(x));
  ok(miss.length === 0, `${tbl} columns ${cols.join('/')}` + (miss.length ? ` — MISSING: ${miss.join(', ')}` : ' present'));
};
await colCheck('profiles', ['role','account_status','verified','suspended_until','deleted_at','force_logout_at']);
await colCheck('calls', ['connection_state','ice_failures','reconnects','turn_used','failure_reason']);

// 4) Total policies across the 3 new tables
const pol = (await c.query(`select count(*)::int n from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace nn on nn.oid=c.relnamespace where nn.nspname='public' and c.relname = any($1)`, [EXPECTED_TABLES])).rows[0].n;
ok(pol >= 5, `RLS policies on new tables: ${pol}`);

// 5) Invoke read-only RPCs (as postgres/superuser these bypass auth but confirm they execute)
const tryRpc = async (label, sql, args = []) => {
  try { const r = await c.query(sql, args); ok(true, `${label} → executes (rows: ${r.rowCount})`); }
  catch (e) { ok(false, `${label} → ERROR: ${e.message.slice(0,80)}`); }
};
await tryRpc('admin_stats()', 'select * from public.admin_stats()');
await tryRpc('admin_call_stats()', 'select * from public.admin_call_stats()');
await tryRpc('admin_message_stats()', 'select * from public.admin_message_stats()');
await tryRpc('admin_db_health()', 'select * from public.admin_db_health()');
await tryRpc('is_owner(null)', 'select public.is_owner(null::uuid)');
await tryRpc('is_admin(null)', 'select public.is_admin(null::uuid)');
await tryRpc('is_moderator(null)', 'select public.is_moderator(null::uuid)');
await tryRpc('admin_search_users(empty)', `select * from public.admin_search_users('')`);
await tryRpc('admin_global_search(x)', `select * from public.admin_global_search('zzz')`);
await tryRpc('feature_flags seeded', `select key, enabled from public.feature_flags order by key`);

// 6) Show seeded feature flags
const flags = (await c.query('select key, enabled from public.feature_flags order by key')).rows;
console.log('\nSeeded feature flags:', flags.map(f => `${f.key}=${f.enabled}`).join(', ') || '(none)');

await c.end();
console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED ✅' : `${fail} CHECK(S) FAILED ❌`}`);
process.exit(fail === 0 ? 0 : 4);
