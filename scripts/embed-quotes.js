#!/usr/bin/env node
/**
 * Embed faculty_quotes via Supabase edge function (OpenRouter on server).
 * Local fallback: OPENROUTER_API_KEY or OPENAI_API_KEY with ./lib/embeddings.js
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { embedDocuments, embeddingToPgvector } from './lib/embeddings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.OPENAI_API_KEY) {
    return;
  }
  for (const p of [join(root, '.env'), join(root, '..', 'castalia.institute', '.env')]) {
    try {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch {
      /* next */
    }
  }
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
}

async function embedViaEdge(url, serviceKey, force) {
  const res = await fetch(`${url.replace(/\/$/, '')}/functions/v1/embed-quotes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ force }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  console.log(`Edge embed: ${data.embedded}/${data.total ?? '?'} quotes`);
  return data;
}

async function main() {
  loadEnv();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const force = process.argv.includes('--force');

  if (!process.argv.includes('--local')) {
    try {
      await embedViaEdge(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, force);
      return;
    } catch (e) {
      console.warn('Edge embed failed, trying local:', e.message);
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let query = supabase
    .from('faculty_quotes')
    .select('id, search_text, quote_text, passage_label, book_title, book_author, tags')
    .eq('status', 'published');

  if (!force) {
    query = query.is('embedded_at', null);
  }

  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows?.length) {
    console.log('No quotes need embedding.');
    return;
  }

  const documents = rows.map((r) => r.search_text || r.quote_text);
  console.log(`Embedding ${rows.length} quote(s) locally...`);
  const vectors = await embedDocuments(documents);

  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const embedding = embeddingToPgvector(vectors[i]);
    const { error: upErr } = await supabase
      .from('faculty_quotes')
      .update({
        embedding,
        embedded_at: new Date().toISOString(),
        search_text: documents[i],
      })
      .eq('id', row.id);
    if (upErr) {
      console.error(row.id, upErr.message);
    } else {
      ok += 1;
    }
  }

  console.log(`Embedded ${ok}/${rows.length} quotes.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
