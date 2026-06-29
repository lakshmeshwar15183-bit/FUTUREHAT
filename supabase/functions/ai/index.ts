// FUTUREHAT+ AI — Supabase Edge Function (Deno). Proxies premium AI actions to
// the Anthropic API. The user's auth JWT is verified, and premium status is
// checked server-side before any model call, so the feature can't be bypassed.
//
// Deploy:  supabase functions deploy ai
// Secrets:
//   supabase secrets set ANTHROPIC_API_KEY=...                 (required)
//   supabase secrets set ANTHROPIC_BASE_URL=https://...        (optional; default api.anthropic.com)
//   supabase secrets set ANTHROPIC_MODEL=claude-haiku-4-5-...  (optional)
// The base URL is configurable so an Anthropic-compatible proxy can be used.
//
// Request body: { action, text?, tone?, targetLang?, transcript? }
//   action: 'rewrite' | 'translate' | 'summarize' | 'smart_reply' | 'assist'

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const ANTHROPIC_BASE_URL = (Deno.env.get('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com').replace(/\/+$/, '');
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5-20251001';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  action: 'rewrite' | 'translate' | 'summarize' | 'smart_reply' | 'assist';
  text?: string;
  tone?: string;
  targetLang?: string;
  transcript?: string;
}

function buildPrompt(b: Body): { system: string; user: string } {
  switch (b.action) {
    case 'rewrite':
      return {
        system: 'You rewrite chat messages. Return ONLY the rewritten message, no preamble, no quotes.',
        user: `Rewrite this message in a ${b.tone || 'clear, friendly'} tone:\n\n${b.text}`,
      };
    case 'translate':
      return {
        system: 'You are a translator. Return ONLY the translation, no notes.',
        user: `Translate this into ${b.targetLang || 'English'}:\n\n${b.text}`,
      };
    case 'summarize':
      return {
        system: 'You summarize chat conversations into concise bullet points.',
        user: `Summarize the key points of this conversation:\n\n${b.transcript}`,
      };
    case 'smart_reply':
      return {
        system:
          'Suggest 3 short, natural replies to the last message. Return ONLY a JSON array of 3 strings.',
        user: `Conversation so far:\n\n${b.transcript}\n\nSuggest 3 replies.`,
      };
    case 'assist':
      return {
        system: 'You are a writing assistant. Draft a chat message from the instruction. Return ONLY the message.',
        user: b.text || '',
      };
    default:
      return { system: 'You are helpful.', user: b.text || '' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    // Verify the caller and their premium status with their own JWT (RLS-scoped).
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return json({ error: 'Unauthorized' }, 401);

    const { data: premium } = await supabase.rpc('is_premium', { uid: userData.user.id });
    if (!premium) return json({ error: 'FUTUREHAT+ required' }, 403);

    const body = (await req.json()) as Body;
    const { system, user } = buildPrompt(body);

    const resp = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'authorization': `Bearer ${ANTHROPIC_API_KEY}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return json({ error: `AI provider error: ${err}` }, 502);
    }
    const data = await resp.json();
    const out = (data.content?.[0]?.text ?? '').trim();

    if (body.action === 'smart_reply') {
      let suggestions: string[] = [];
      try {
        const parsed = JSON.parse(out);
        // The model may return a bare array or wrap it (e.g. {"replies":[...]}).
        // Only accept an array of strings; otherwise fall back to line-splitting.
        suggestions = Array.isArray(parsed)
          ? parsed.filter((s: unknown) => typeof s === 'string')
          : [];
        if (suggestions.length === 0) throw new Error('not a string array');
      } catch {
        suggestions = out.split('\n').map((s: string) => s.replace(/^[-*\d.]+\s*/, '').trim()).filter(Boolean).slice(0, 3);
      }
      return json({ suggestions });
    }
    return json({ result: out });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
