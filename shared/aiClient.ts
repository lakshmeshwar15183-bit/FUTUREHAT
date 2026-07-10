// Lumixo+ — client for the `ai` edge function. Shared by web and mobile.
// All calls require an authenticated, premium user (enforced server-side).

import type { SupabaseClient } from '@supabase/supabase-js';

type AiAction = 'rewrite' | 'translate' | 'summarize' | 'smart_reply' | 'assist';

async function call(client: SupabaseClient, body: Record<string, unknown> & { action: AiAction }) {
  const { data, error } = await client.functions.invoke('ai', { body });
  if (error) {
    // On a non-2xx, supabase-js sets `error` and leaves `data` null — the server's
    // JSON body (e.g. {"error":"Lumixo+ required"}) lives in error.context (a Response).
    let msg = error.message || 'AI request failed';
    const ctx = (error as any).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        if (j && j.error) msg = j.error;
      } catch {
        /* body wasn't JSON — keep the generic message */
      }
    }
    throw new Error(msg);
  }
  if (data && (data as any).error) throw new Error((data as any).error);
  return data as { result?: string; suggestions?: string[] };
}

export async function aiRewrite(client: SupabaseClient, text: string, tone?: string): Promise<string> {
  const r = await call(client, { action: 'rewrite', text, tone });
  return r.result ?? '';
}

export async function aiTranslate(client: SupabaseClient, text: string, targetLang: string): Promise<string> {
  const r = await call(client, { action: 'translate', text, targetLang });
  return r.result ?? '';
}

export async function aiSummarize(client: SupabaseClient, transcript: string): Promise<string> {
  const r = await call(client, { action: 'summarize', transcript });
  return r.result ?? '';
}

export async function aiSmartReply(client: SupabaseClient, transcript: string): Promise<string[]> {
  const r = await call(client, { action: 'smart_reply', transcript });
  return r.suggestions ?? [];
}

export async function aiAssist(client: SupabaseClient, instruction: string): Promise<string> {
  const r = await call(client, { action: 'assist', text: instruction });
  return r.result ?? '';
}
