#!/usr/bin/env node
/**
 * Upsert seed quotes into public.faculty_quotes and link book_id when
 * a matching Bibliotech books row exists (source + source_id).
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in env or ../castalia.institute/.env
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const paths = [
    join(root, '.env'),
    join(root, '..', 'castalia.institute', '.env'),
    join(root, '..', 'bibliotech', '.env'),
  ];
  for (const p of paths) {
    try {
      const text = readFileSync(p, 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2].replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
      if (process.env.SUPABASE_URL) return;
    } catch {
      /* try next */
    }
  }
}

async function resolveBookId(supabase, source, sourceId) {
  const { data, error } = await supabase
    .from('books')
    .select('id')
    .eq('source', source)
    .eq('source_id', sourceId)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function main() {
  await loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const seed = JSON.parse(readFileSync(join(root, 'data', 'seed-quotes.json'), 'utf8'));
  const supabase = createClient(url, key);

  let linked = 0;
  let upserted = 0;

  for (const row of seed) {
    const bookId =
      row.source && row.source_id
        ? await resolveBookId(supabase, row.source, String(row.source_id))
        : null;
    if (bookId) linked += 1;

    const record = {
      faculty_id: row.faculty_id,
      book_id: bookId,
      quote_text: row.quote_text,
      passage_label: row.passage_label ?? null,
      book_title: row.book_title ?? null,
      book_author: row.book_author ?? null,
      source: row.source ?? null,
      source_id: row.source_id != null ? String(row.source_id) : null,
      tags: row.tags ?? [],
      notes: row.notes ?? null,
      epub_locator: row.epub_locator ?? {},
      cfi: row.cfi ?? null,
      status: 'published',
    };

    if (dryRun) {
      console.log('[dry-run]', record.faculty_id, record.passage_label, bookId ? `book=${bookId}` : 'no book');
      continue;
    }

    const { data: existing } = await supabase
      .from('faculty_quotes')
      .select('id')
      .eq('faculty_id', record.faculty_id)
      .eq('quote_text', record.quote_text)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase.from('faculty_quotes').update(record).eq('id', existing.id);
      if (error) console.error('Update failed:', record.faculty_id, error.message);
      else upserted += 1;
    } else {
      const { error } = await supabase.from('faculty_quotes').insert(record);
      if (error) console.error('Insert failed:', record.faculty_id, error.message);
      else upserted += 1;
    }
  }

  console.log(`Done. upserted=${upserted} linked_books=${linked}/${seed.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
