import { Client } from 'pg';
const REF = 'toscljrivrawvlfebdzz';
const c = new Client({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com', port: 5432,
  user: `postgres.${REF}`, password: process.env.DBPASS, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
await c.connect();
let fail = 0;
const ok = (b, m) => { console.log(`${b ? '✅' : '❌'} ${m}`); if (!b) fail++; };

// developer_accounts allowlist
const devs = (await c.query('select email from public.developer_accounts')).rows.map(r => r.email);
console.log('developer_accounts allowlist:', devs.length ? devs.join(', ') : '(empty)');

// Find an owner user id (email in allowlist)
let owner = (await c.query(`select u.id, u.email from auth.users u
  join public.developer_accounts d on lower(u.email)=lower(d.email) limit 1`)).rows[0];
if (!owner) {
  // fall back to any admin-role profile
  owner = (await c.query(`select id, null email from public.profiles where role='admin' limit 1`)).rows[0];
}
if (!owner) { console.log('⚠️  No owner/admin account exists yet — cannot run authorized-path test.'); await c.end(); process.exit(0); }
console.log('Impersonating owner/admin:', owner.email || owner.id, '\n');

// confirm they are recognized as owner+admin
const priv = (await c.query('select public.is_owner($1) o, public.is_admin($1) a', [owner.id])).rows[0];
ok(priv.a, `is_admin(owner) = ${priv.a}`);
console.log(`   is_owner(owner) = ${priv.o}`);

// Impersonate inside a rolled-back transaction: set the JWT claims GUC that auth.uid() reads.
async function asAdmin(label, sql, args = []) {
  try {
    await c.query('begin');
    await c.query(`select set_config('role','authenticated',true)`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.id, role: 'authenticated' })]);
    const r = await c.query(sql, args);
    await c.query('rollback');
    ok(true, `${label} → OK (rows: ${r.rowCount})`);
    return r.rows;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    ok(false, `${label} → ERROR: ${e.message.slice(0, 90)}`);
    return null;
  }
}

const stats = await asAdmin('admin_stats() as admin', 'select * from public.admin_stats()');
if (stats) console.log('   stats sample:', JSON.stringify(stats[0]).slice(0, 160));
await asAdmin('admin_call_stats() as admin', 'select * from public.admin_call_stats()');
await asAdmin('admin_message_stats() as admin', 'select * from public.admin_message_stats()');
await asAdmin('admin_db_health() as admin', 'select * from public.admin_db_health()');
await asAdmin('admin_search_users("") as admin', `select * from public.admin_search_users('')`);
await asAdmin('admin_global_search("a") as admin', `select * from public.admin_global_search('a')`);
await asAdmin('admin_audit_log(10) as owner', 'select * from public.admin_audit_log(10)');

await c.end();
console.log(`\n${fail === 0 ? 'AUTHORIZED-PATH CHECKS PASSED ✅' : `${fail} FAILED ❌`}`);
process.exit(fail === 0 ? 0 : 5);
