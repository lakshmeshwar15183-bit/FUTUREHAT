// Lumixo — optional writing-tools Edge Function (premium-gated, server-side).
// Secrets (server only): AI_API_KEY, AI_BASE_URL, AI_MODEL
// Legacy env aliases still accepted for existing deployments.
//
// Deploy:  supabase functions deploy ai

import { createClient } from 'jsr:@supabase/supabase-js@2';

const AI_API_KEY = Deno.env.get('AI_API_KEY') ?? '';
const AI_BASE_URL = (Deno.env.get('AI_BASE_URL') ?? '').replace(/\/+$/, '');
const MODEL = Deno.env.get('AI_MODEL') ?? 'default';

const ALLOWED_ACTIONS = new Set(['rewrite', 'translate', 'summarize', 'smart_reply', 'assist']);
const MAX_TEXT = 4000;
const MAX_TRANSCRIPT = 12000;
const AI_RATE_PER_MIN = 20;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  action: string;
  text?: string;
  tone?: string;
  targetLang?: string;
  transcript?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

function clamp(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

function buildPrompt(b: Body): { system: string; user: string } | null {
  if (!ALLOWED_ACTIONS.has(b.action)) return null;
  const text = clamp(b.text, MAX_TEXT);
  const transcript = clamp(b.transcript, MAX_TRANSCRIPT);
  const tone = clamp(b.tone, 40) || 'clear, friendly';
  const targetLang = clamp(b.targetLang, 40) || 'English';

  switch (b.action) {
    case 'rewrite':
      if (!text.trim()) return null;
      return {
        system: 'You rewrite chat messages. Return ONLY the rewritten message, no preamble, no quotes.',
        user: `Rewrite this message in a ${tone} tone:\n\n${text}`,
      };
    case 'translate':
      if (!text.trim()) return null;
      return {
        system: 'You are a translator. Return ONLY the translation, no notes.',
        user: `Translate this into ${targetLang}:\n\n${text}`,
      };
    case 'summarize':
      if (!transcript.trim()) return null;
      return {
        system: 'You summarize chat conversations into concise bullet points.',
        user: `Summarize the key points of this conversation:\n\n${transcript}`,
      };
    case 'smart_reply':
      if (!transcript.trim()) return null;
      return {
        system:
          'Suggest 3 short, natural replies to the last message. Return ONLY a JSON array of 3 strings.',
        user: `Conversation so far:\n\n${transcript}\n\nSuggest 3 replies.`,
      };
    case 'assist':
      if (!text.trim()) return null;
      return {
        system: 'You draft a chat message from the instruction. Return ONLY the message.',
        user: text,
      };
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!AI_API_KEY || !AI_BASE_URL) {
      return json({ error: 'Writing tools not configured' }, 503);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return json({ error: 'Unauthorized' }, 401);

    const { data: premium } = await supabase.rpc('is_premium', { uid: userData.user.id });
    if (!premium) return json({ error: 'Lumixo+ required' }, 403);

    try {
      const { data: ok, error: rlErr } = await supabase.rpc('check_rate_limit', {
        p_action: 'ai',
        p_max_per_minute: AI_RATE_PER_MIN,
      });
      if (rlErr) {
        if (!/function|does not exist|schema cache/i.test(rlErr.message ?? '')) {
          return json({ error: 'rate limit check failed' }, 429);
        }
      } else if (ok === false) {
        return json({ error: 'rate limit exceeded' }, 429);
      }
    } catch {
      /* continue if RPC unavailable */
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    const prompt = buildPrompt(body ?? ({} as Body));
    if (!prompt) return json({ error: 'invalid action or empty input' }, 400);

    const resp = await fetch(`${AI_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': AI_API_KEY,
        // Compatibility version header for Messages-compatible gateways.
        'x-api-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      }),
    });

    if (!resp.ok) {
      console.error('[writing-tools] provider status', resp.status);
      return json({ error: 'Provider error' }, 502);
    }
    const data = await resp.json();
    const out = String(data.content?.[0]?.text ?? '').trim().slice(0, 8000);

    if (body.action === 'smart_reply') {
      let suggestions: string[] = [];
      try {
        const parsed = JSON.parse(out);
        suggestions = Array.isArray(parsed)
          ? parsed.filter((s: unknown) => typeof s === 'string')
          : [];
        if (suggestions.length === 0) throw new Error('not a string array');
      } catch {
        suggestions = out
          .split('\n')
          .map((s: string) => s.replace(/^[-*\d.]+\s*/, '').trim())
          .filter(Boolean)
          .slice(0, 3);
      }
      return json({ suggestions: suggestions.slice(0, 3) });
    }

    return json({ text: out, result: out });
  } catch (e) {
    console.error('[writing-tools]', e instanceof Error ? e.message : 'error');
    return json({ error: 'internal error' }, 500);
  }
});
