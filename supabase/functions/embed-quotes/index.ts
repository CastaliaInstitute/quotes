// POST {} — embed all published quotes missing embeddings (service role only).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GCP_API_KEY') ?? '';

function isServiceRoleJwt(authHeader: string | null): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  try {
    const payload = JSON.parse(atob(authHeader.slice(7).split('.')[1] ?? ''));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

async function embedBatchGemini(texts: string[]): Promise<number[][]> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 1536,
      })),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embeddings ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.embeddings ?? []).map((e: { values: number[] }) => e.values);
}

async function embedBatchOpenRouter(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://quotes.castalia.institute',
      'X-Title': 'Castalia Quotes Embed',
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-large',
      input: texts,
      dimensions: 1536,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter embeddings ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const sorted = [...(data.data ?? [])].sort(
    (a: { index: number }, b: { index: number }) => a.index - b.index,
  );
  return sorted.map((d: { embedding: number[] }) => d.embedding);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (OPENROUTER_API_KEY) {
    try {
      return await embedBatchOpenRouter(texts);
    } catch (e) {
      console.warn('OpenRouter embed failed, trying Gemini:', e);
    }
  }
  return await embedBatchGemini(texts);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = req.headers.get('Authorization');
  if (!isServiceRoleJwt(auth)) {
    return new Response(JSON.stringify({ error: 'service role JWT required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const force = Boolean(body.force);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    let query = supabase
      .from('faculty_quotes')
      .select('id, search_text, quote_text')
      .eq('status', 'published');

    if (!force) query = query.is('embedded_at', null);

    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows?.length) {
      return new Response(JSON.stringify({ embedded: 0, message: 'nothing to embed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const documents = rows.map((r) => r.search_text || r.quote_text);
    const vectors = await embedBatch(documents);

    let embedded = 0;
    for (let i = 0; i < rows.length; i++) {
      const { error: upErr } = await supabase
        .from('faculty_quotes')
        .update({
          embedding: `[${vectors[i].join(',')}]`,
          embedded_at: new Date().toISOString(),
          search_text: documents[i],
        })
        .eq('id', rows[i].id);
      if (!upErr) embedded += 1;
    }

    return new Response(JSON.stringify({ embedded, total: rows.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
