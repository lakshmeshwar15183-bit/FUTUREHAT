// Run scripts/streak-tests.sql against Supabase (session pooler). The SQL file
// manages its OWN transaction (begin … rollback), so we execute it verbatim and
// surface NOTICE output. Usage: DBPASS='…' node scripts/streak-run-tests.mjs
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';

const PASSWORD = process.env.DBPASS;
const REF = 'toscljrivrawvlfebdzz';
if (!PASSWORD) { console.error('set DBPASS'); process.exit(1); }

const sql = await readFile(new URL('./streak-tests.sql', import.meta.url), 'utf8');
const client = new Client({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com',
  port: 5432,
  user: `postgres.${REF}`,
  password: PASSWORD, database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  statement_timeout: 120000,
});

client.on('notice', (n) => console.log('NOTICE:', n.message));
await client.connect();
console.log('Connected. Running streak-tests.sql (self-rollbacking)…');
try {
  await client.query(sql);
  console.log('\n✅ streak-tests.sql completed without error (all assertions passed).');
} catch (e) {
  console.error('\n❌ TEST FAILED:', e.message);
  if (e.where) console.error('  where:', e.where);
  process.exitCode = 3;
} finally {
  await client.end();
}
