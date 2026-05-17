/**
 * Embeddings for faculty_quotes RAG (1536-dim).
 * Prefers OpenRouter; falls back to OpenAI when available.
 */

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';

export const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-large';
export const EMBEDDING_DIMENSION = 1536;

export function embeddingToPgvector(embedding) {
  return `[${embedding.join(',')}]`;
}

async function openrouterEmbedBatch(apiKey, inputs) {
  const res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://quotes.castalia.institute',
      'X-Title': 'Castalia Quotes',
    },
    body: JSON.stringify({
      model: DEFAULT_EMBEDDING_MODEL,
      input: inputs,
      dimensions: EMBEDDING_DIMENSION,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter embeddings HTTP ${res.status}: ${err.slice(0, 500)}`);
  }
  const json = await res.json();
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

async function openaiEmbedBatch(apiKey, inputs) {
  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-large',
      input: inputs,
      dimensions: EMBEDDING_DIMENSION,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embeddings HTTP ${res.status}: ${err.slice(0, 500)}`);
  }
  const json = await res.json();
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

async function geminiEmbedBatch(apiKey, inputs) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: inputs.map((text) => ({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSION,
      })),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embeddings HTTP ${res.status}: ${err.slice(0, 500)}`);
  }
  const json = await res.json();
  return (json.embeddings ?? []).map((e) => e.values);
}

export async function embedDocuments(inputs) {
  if (inputs.length === 0) return [];
  const orKey = process.env.OPENROUTER_API_KEY;
  const oaKey = process.env.OPENAI_API_KEY;
  const gemKey = process.env.GEMINI_API_KEY || process.env.GCP_API_KEY;
  const out = [];
  const batchSize = 50;
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    let vectors;
    if (orKey) {
      try {
        vectors = await openrouterEmbedBatch(orKey, batch);
      } catch (e) {
        if (!gemKey) throw e;
        vectors = await geminiEmbedBatch(gemKey, batch);
      }
    } else if (gemKey) {
      vectors = await geminiEmbedBatch(gemKey, batch);
    } else if (oaKey) {
      vectors = await openaiEmbedBatch(oaKey, batch);
    } else {
      throw new Error('Set OPENROUTER_API_KEY, GEMINI_API_KEY, or run embed via edge (no --local)');
    }
    for (const v of vectors) {
      if (v.length !== EMBEDDING_DIMENSION) {
        throw new Error(`Expected ${EMBEDDING_DIMENSION}-dim, got ${v.length}`);
      }
      out.push(v);
    }
  }
  return out;
}

export async function openaiEmbed(text) {
  const [vec] = await embedDocuments([text]);
  return vec;
}
