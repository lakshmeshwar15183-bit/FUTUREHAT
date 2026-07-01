import { Client } from 'pg';
const PASSWORD = process.env.DBPASS;
const REF = 'toscljrivrawvlfebdzz';
const regions = [
  'us-east-1','us-east-2','us-west-1','us-west-2',
  'eu-west-1','eu-west-2','eu-west-3','eu-central-1','eu-central-2','eu-north-1',
  'ap-south-1','ap-southeast-1','ap-southeast-2','ap-northeast-1','ap-northeast-2',
  'sa-east-1','ca-central-1',
];
for (const region of regions) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const client = new Client({
    host, port: 5432, user: `postgres.${REF}`,
    password: PASSWORD, database: 'postgres',
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 6000,
  });
  try {
    await client.connect();
    const r = await client.query('select current_database() db');
    console.log(`FOUND region=${region} host=${host} db=${r.rows[0].db}`);
    await client.end();
    process.exit(0);
  } catch (e) {
    const msg = e.message.replace(/\s+/g,' ').slice(0,60);
    console.log(`  ${region}: ${msg}`);
    try { await client.end(); } catch {}
  }
}
console.log('NO_REGION_FOUND');
process.exit(2);
