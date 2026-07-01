// Diagnostic: can we authenticate two users against the real project?
import { createClient } from '@supabase/supabase-js';

const URL = 'https://toscljrivrawvlfebdzz.supabase.co';
const KEY = 'sb_publishable_qZsG21qWLfgNCfRqOpn2tw_PsLOKiai';

const mk = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureUser(email, password) {
  const c = mk();
  let { data: si, error: se } = await c.auth.signInWithPassword({ email, password });
  if (si?.user) return { how: 'signin', user: si.user, client: c };
  const { data: su, error: ue } = await c.auth.signUp({ email, password });
  if (ue) return { how: 'error', error: `signup: ${ue.message} | signin: ${se?.message}` };
  // try sign-in again (in case confirmation is off, signUp may already create a session)
  if (su?.session) return { how: 'signup+session', user: su.user, client: c };
  const retry = await c.auth.signInWithPassword({ email, password });
  if (retry.data?.user) return { how: 'signup+signin', user: retry.data.user, client: c };
  return { how: 'needs-confirm', user: su?.user ?? null, error: retry.error?.message };
}

const A = await ensureUser('diag_a@futurehat.test', 'Diag!2026pass');
const B = await ensureUser('diag_b@futurehat.test', 'Diag!2026pass');
console.log('A:', A.how, A.user?.id ?? A.error);
console.log('B:', B.how, B.user?.id ?? B.error);
process.exit(0);
