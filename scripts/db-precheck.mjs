import { Client } from 'pg';
const REF = 'toscljrivrawvlfebdzz';
const c = new Client({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com', port: 5432,
  user: `postgres.${REF}`, password: process.env.DBPASS, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
await c.connect();
const v = await c.query('select current_user u, current_database() d');
console.log('CONNECTED as', v.rows[0].u, 'db', v.rows[0].d);
const pre = await c.query(`select
  to_regclass('public.feature_flags')::text ff,
  to_regclass('public.announcements')::text ann,
  to_regclass('public.devices')::text dev,
  to_regprocedure('public.is_owner(uuid)')::text isowner`);
console.log('Pre-migration state (null = not yet present):', pre.rows[0]);
await c.end();
