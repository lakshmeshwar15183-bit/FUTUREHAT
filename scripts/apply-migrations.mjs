// One-off migration runner for Lumixo. Applies the reactions + premium
// migrations via the Supabase session pooler. Connection details are passed
// through env vars (never hardcode the password).
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node apply-migrations.mjs <file.sql> [...]');
  process.exit(1);
}

// Either pass a full connection string (DATABASE_URL), or discrete PG* env vars.
const client = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Client({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'postgres',
      ssl: { rejectUnauthorized: false },
    });

const main = async () => {
  await client.connect();
  for (const f of files) {
    const sql = readFileSync(f, 'utf8');
    process.stdout.write(`\n=== applying ${f} ===\n`);
    await client.query(sql);
    console.log(`OK: ${f}`);
  }
  await client.end();
  console.log('\nAll migrations applied.');
};

main().catch(async (e) => {
  console.error('MIGRATION ERROR:', e.message);
  try { await client.end(); } catch {}
  process.exit(1);
});
