// Probe: can we reach the DB over a verified TLS connection (no weakening)?
import { Client } from 'pg';

async function tryConnect(label, ssl) {
  const c = new Client({
    host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER, password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'postgres', ssl,
  });
  try {
    await c.connect();
    const r = await c.query('select 1 as ok');
    console.log(`${label}: CONNECTED ok=${r.rows[0].ok}`);
    await c.end();
    return true;
  } catch (e) {
    console.log(`${label}: FAILED — ${e.message}`);
    try { await c.end(); } catch {}
    return false;
  }
}

await tryConnect('ssl:true (verify)', true);
await tryConnect("ssl require (no verify host)", { require: true, rejectUnauthorized: true });
