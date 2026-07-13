// Lumixo+ — client for the optional `ai` edge function (writing tools).
// Authenticated + premium required (enforced server-side).

import type { SupabaseClient } from '@supabase/supabase-js';

type WritingAction = 'rewrite' | 'translate' | 'summarize' | 'smart_reply' | 'assist';

async function call(
  client: SupabaseClient,
  body: Record<string, unknown> & { action: WritingAction },
) {
  const { data, error } = await client.functions.invoke('ai', { body });
  if (error) {
    let msg = error.message || 'Request failed';
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        if (j && j.error) msg = j.error;
      } catch {
        /* keep generic message */
      }
    }
    throw new Error(msg);
  }
  if (data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as { result?: string; text?: string; suggestions?: string[] };
}

export async function aiRewrite(client: SupabaseClient, text: string, tone?: string): Promise<string> {
  const r = await call(client, { action: 'rewrite', text, tone });
  return r.result ?? r.text ?? '';
}

export async function aiTranslate(client: SupabaseClient, text: string, targetLang: string): Promise<string> {
  const r = await call(client, { action: 'translate', text, targetLang });
  return r.result ?? r.text ?? '';
}

export async function aiSummarize(client: SupabaseClient, transcript: string): Promise<string> {
  const r = await call(client, { action: 'summarize', transcript });
  return r.result ?? r.text ?? '';
}

export async function aiSmartReply(client: SupabaseClient, transcript: string): Promise<string[]> {
  const r = await call(client, { action: 'smart_reply', transcript });
  return r.suggestions ?? [];
}

export async function aiAssist(client: SupabaseClient, instruction: string): Promise<string> {
  const r = await call(client, { action: 'assist', text: instruction });
  return r.result ?? r.text ?? '';
}
