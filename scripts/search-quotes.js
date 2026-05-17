#!/usr/bin/env node
/**
 * Search faculty quotes by topic (semantic).
 *
 * Usage:
 *   npm run search -- "stoicism and inner strength"
 *   npm run search -- "nature solitude" --faculty a.thoreau --limit 5
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { openaiEmbed, embeddingToPgvector, embedDocuments } from './lib/embeddings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.OPENAI_API_KEY) return;
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
  if (!process.env.SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
}

function parseArgs(argv) {
  const queryParts = [];
  let faculty = null;
  let limit = 8;
  let threshold = 0.3;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--faculty') faculty = argv[++i];
    else if (a === '--limit') limit = Number(argv[++i]);
    else if (a === '--threshold') threshold = Number(argv[++i]);
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) queryParts.push(a);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    console.error('Usage: npm run search -- "<topic query>" [--faculty a.plato] [--limit 8] [--json]');
    process.exit(1);
  }
  return { query, faculty, limit, threshold, json };
}

async function searchViaEdge(url, anonKey, query, faculty, limit, threshold) {
  const res = await fetch(`${url.replace(/\/$/, '')}/functions/v1/search-quotes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      limit,
      match_threshold: threshold,
      faculty_id: faculty,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.results ?? [];
}

async function main() {
  loadEnv();
  const { query, faculty, limit, threshold, json } = parseArgs(process.argv.slice(2));

  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Need SUPABASE_URL and anon or service role key');
    process.exit(1);
  }

  let data;
  const useLocal =
    process.argv.includes('--local') &&
    (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.GCP_API_KEY || process.env.OPENAI_API_KEY);

  if (useLocal) {
    const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? key);
    const [vector] = await embedDocuments([query]);
    const { data: rows, error } = await supabase.rpc('search_faculty_quotes', {
      query_embedding: embeddingToPgvector(vector),
      match_count: limit,
      match_threshold: threshold,
      filter_faculty_id: faculty,
    });
    if (error) throw error;
    data = rows;
  } else {
    try {
      data = await searchViaEdge(url, key, query, faculty, limit, threshold);
    } catch (e) {
      if (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.GCP_API_KEY) {
        const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? key);
        const [vector] = await embedDocuments([query]);
        const { data: rows, error } = await supabase.rpc('search_faculty_quotes', {
          query_embedding: embeddingToPgvector(vector),
          match_count: limit,
          match_threshold: threshold,
          filter_faculty_id: faculty,
        });
        if (error) throw error;
        data = rows;
      } else {
        throw e;
      }
    }
  }

  if (json) {
    console.log(JSON.stringify({ query, results: data }, null, 2));
    return;
  }

  if (!data?.length) {
    console.log('No matching quotes. Try a broader query or lower --threshold.');
    return;
  }

  console.log(`\nTopic: "${query}" — ${data.length} result(s)\n`);
  for (const [i, row] of data.entries()) {
    console.log(`${i + 1}. [${(row.similarity * 100).toFixed(0)}%] ${row.faculty_name} (${row.faculty_id})`);
    console.log(`   "${row.quote_text}"`);
    if (row.passage_label) console.log(`   — ${row.passage_label}`);
    if (row.readest_url) console.log(`   ${row.readest_url}`);
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
