import { Client } from 'pg';

const PASSWORD = process.env.DBPASS;
const REF = 'toscljrivrawvlfebdzz';

// Candidate endpoints, in order of preference.
const candidates = [
  { name: 'direct',          host: `db.${REF}.supabase.co`, port: 5432, user: 'postgres' },
  { name: 'pooler-session',  host: `aws-0-ap-south-1.pooler.supabase.com`, port: 5432, user: `postgres.${REF}` },
  { name: 'pooler-us-east',  host: `aws-0-us-east-1.pooler.supabase.com`, port: 5432, user: `postgres.${REF}` },
  { name: 'pooler-us-west',  host: `aws-0-us-west-1.pooler.supabase.com`, port: 5432, user: `postgres.${REF}` },
  { name: 'pooler-eu-central', host: `aws-0-eu-central-1.pooler.supabase.com`, port: 5432, user: `postgres.${REF}` },
];

for (const c of candidates) {
  const client = new Client({
    host: c.host, port: c.port, user: c.user,
    password: PASSWORD, database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    const r = await client.query('select current_database() db, current_user usr, version()');
    console.log(`OK ${c.name} -> ${c.host}:${c.port} user=${c.user}`);
    console.log('   ', r.rows[0].db, r.rows[0].usr);
    await client.end();
    console.log('WORKING_ENDPOINT=' + JSON.stringify(c));
    process.exit(0);
  } catch (e) {
    console.log(`FAIL ${c.name} (${c.host}): ${e.message}`);
    try { await client.end(); } catch {}
  }
}
process.exit(2);
