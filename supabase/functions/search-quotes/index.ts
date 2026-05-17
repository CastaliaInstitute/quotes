// POST { "query": "stoicism", "limit": 8, "faculty_id": "a.marcusaurelius" }
// Semantic search over faculty_quotes via pgvector.

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

async function embedQueryGemini(text: string): Promise<number[]> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] },
      outputDimensionality: 1536,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embeddings ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.embedding?.values ?? [];
}

async function embedQueryOpenRouter(text: string): Promise<number[]> {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://quotes.castalia.institute',
      'X-Title': 'Castalia Quotes Search',
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-large',
      input: text,
      dimensions: 1536,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter embeddings ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.data?.[0]?.embedding ?? [];
}

async function embedQuery(text: string): Promise<number[]> {
  if (OPENROUTER_API_KEY) {
    try {
      return await embedQueryOpenRouter(text);
    } catch (e) {
      console.warn('OpenRouter embed failed, trying Gemini:', e);
    }
  }
  return await embedQueryGemini(text);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return new Response(JSON.stringify({ error: 'query is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 25);
    const threshold = Number(body.match_threshold) || 0.3;
    const facultyId = typeof body.faculty_id === 'string' ? body.faculty_id : null;

    const embedding = await embedQuery(query);
    if (embedding.length !== 1536) {
      throw new Error(`Unexpected embedding dimension: ${embedding.length}`);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase.rpc('search_faculty_quotes', {
      query_embedding: `[${embedding.join(',')}]`,
      match_count: limit,
      match_threshold: threshold,
      filter_faculty_id: facultyId,
    });

    if (error) throw error;

    return new Response(JSON.stringify({ query, results: data ?? [] }), {
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
