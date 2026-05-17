#!/usr/bin/env node
/** Write data/quotes.json from faculty_quotes_public for GitHub Pages build. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  for (const p of [join(root, '.env'), join(root, '..', 'castalia.institute', '.env')]) {
    try {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      if (process.env.SUPABASE_URL) return;
    } catch {
      /* next */
    }
  }
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
}

async function main() {
  await loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY)');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('faculty_quotes_public')
    .select(
      'faculty_id,faculty_name,book_id,quote_text,passage_label,cfi,book_title,book_author,source,source_id,tags,readest_url',
    )
    .order('faculty_id');

  if (error) throw error;
  const out = join(root, 'data', 'quotes.json');
  writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${data.length} quotes to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
