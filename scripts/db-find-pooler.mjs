import { Client } from 'pg';
const PASSWORD = process.env.DBPASS;
const REF = 'toscljrivrawvlfebdzz';
// IPv6 prefix 2406:da12 => AWS Asia Pacific. Try AP regions first, all prefixes.
const prefixes = ['aws-0', 'aws-1', 'aws-2'];
const regions = ['ap-south-1','ap-southeast-1','ap-southeast-2','ap-northeast-1','ap-northeast-2','us-east-1','us-east-2','eu-central-1'];
const ports = [6543, 5432]; // transaction pooler, then session pooler
for (const region of regions) {
  for (const prefix of prefixes) {
    for (const port of ports) {
      const host = `${prefix}-${region}.pooler.supabase.com`;
      const client = new Client({
        host, port, user: `postgres.${REF}`,
        password: PASSWORD, database: 'postgres',
        ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 6000,
      });
      try {
        await client.connect();
        const r = await client.query('select current_database() db, current_user usr');
        console.log(`FOUND host=${host} port=${port} db=${r.rows[0].db} user=${r.rows[0].usr}`);
        await client.end();
        console.log('POOLER=' + JSON.stringify({ host, port, user: `postgres.${REF}` }));
        process.exit(0);
      } catch (e) {
        const m = e.message.replace(/\s+/g, ' ').slice(0, 45);
        console.log(`  ${prefix}-${region}:${port} -> ${m}`);
        try { await client.end(); } catch {}
      }
    }
  }
}
console.log('NONE');
process.exit(2);
