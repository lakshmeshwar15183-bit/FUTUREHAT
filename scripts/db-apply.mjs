// Apply a SQL migration to Supabase via the session pooler (IPv4-reachable).
// Wraps the whole file in a single transaction (the migration itself is
// idempotent + additive, but we still want all-or-nothing).
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';

const PASSWORD = process.env.DBPASS;
const REF = 'toscljrivrawvlfebdzz';
const FILE = process.argv[2];
if (!FILE) { console.error('usage: node db-apply.mjs <sqlfile>'); process.exit(1); }

const sql = await readFile(FILE, 'utf8');
console.log(`Loaded ${FILE} (${sql.length} bytes)`);

const client = new Client({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com',
  port: 5432, // session pooler — full transaction support
  user: `postgres.${REF}`,
  password: PASSWORD, database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  statement_timeout: 120000,
});

await client.connect();
console.log('Connected via session pooler. Applying migration inside a transaction…');
try {
  await client.query('begin');
  await client.query(sql); // simple-query protocol: supports multiple statements
  await client.query('commit');
  console.log('COMMIT OK — migration applied successfully.');
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error('ROLLBACK — migration failed:');
  console.error(`  ${e.message}`);
  if (e.position) console.error(`  at SQL character position ${e.position}`);
  if (e.where) console.error(`  where: ${e.where}`);
  process.exitCode = 3;
} finally {
  await client.end();
}
