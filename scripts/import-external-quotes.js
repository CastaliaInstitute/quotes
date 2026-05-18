#!/usr/bin/env node
/**
 * Import bulk quotes from quotable-io/data (or alvations/Quotables) into faculty_quotes as drafts.
 *
 * Usage:
 *   npm run import:quotable -- --dry-run --limit 100
 *   npm run import:quotable -- --limit 500
 *   npm run import:quotable -- --source quotables --refresh
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig, root, loadEnv } from './lib/load-env.js';
import { buildFacultyMatcher, loadAllFaculty } from './lib/match-faculty.js';
import { fetchSource, listSources } from './lib/fetch-sources.js';

function parseArgs(argv) {
  const opts = {
    source: 'quotable',
    limit: Infinity,
    dryRun: false,
    refresh: false,
    onlyMatched: true,
    minLength: 24,
    maxLength: 600,
    batchSize: 80,
    status: 'draft',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '--all-authors') opts.onlyMatched = false;
    else if (a === '--publish') opts.status = 'published';
    else if (a === '--source') opts.source = argv[++i];
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--min-length') opts.minLength = Number(argv[++i]);
    else if (a === '--batch') opts.batchSize = Number(argv[++i]);
  }
  return opts;
}

function normalizeTags(tags) {
  const base = ['imported', ...(tags ?? [])];
  return [...new Set(base.map((t) => t.toLowerCase().replace(/[^a-z0-9-]+/g, '-')))].filter(Boolean);
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  if (!listSources().includes(opts.source)) {
    console.error(`Unknown --source ${opts.source}. Options: ${listSources().join(', ')}`);
    process.exit(1);
  }

  console.log(`Fetching ${opts.source}…`);
  let rows = await fetchSource(opts.source, { refresh: opts.refresh });
  console.log(`  ${rows.length} raw quotes`);

  rows = rows.filter((r) => {
    const len = r.quote_text.length;
    return len >= opts.minLength && len <= opts.maxLength;
  });
  if (Number.isFinite(opts.limit)) rows = rows.slice(0, opts.limit);
  console.log(`  ${rows.length} after length filter (limit)`);

  const { url, key } = getSupabaseConfig();
  const supabase = createClient(url, key);

  console.log('Loading faculty…');
  const facultyRows = await loadAllFaculty(supabase);
  const { matchAuthor } = buildFacultyMatcher(facultyRows);
  console.log(`  ${facultyRows.length} faculty rows`);

  const prepared = [];
  const stats = { matched: 0, skipped: 0, reasons: {} };

  for (const row of rows) {
    const { facultyId, reason } = matchAuthor(row.book_author);
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
    if (!facultyId) {
      stats.skipped += 1;
      if (!opts.onlyMatched) {
        /* skip inserting unmatched */
      }
      continue;
    }
    stats.matched += 1;
    prepared.push({
      faculty_id: facultyId,
      quote_text: row.quote_text,
      book_author: row.book_author,
      passage_label: null,
      book_title: null,
      source: `import:${opts.source}`,
      source_id: row.external_id,
      tags: normalizeTags(row.tags),
      status: opts.status,
      notes: `Imported from ${opts.source} (${row.external_id}). Verify attribution before publishing.`,
      epub_locator: {
        import: { source: opts.source, id: row.external_id },
      },
    });
  }

  console.log(`Matched ${stats.matched} / ${rows.length} (skipped ${stats.skipped})`);
  console.log('Match reasons:', stats.reasons);

  const reportPath = join(root, 'data', 'cache', `import-${opts.source}-prepared.json`);
  mkdirSync(join(root, 'data', 'cache'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(prepared, null, 2) + '\n');
  console.log(`Wrote ${reportPath}`);

  if (opts.dryRun) {
    console.log('Dry run — no database writes.');
    console.log('Sample:', prepared.slice(0, 3));
    return;
  }

  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < prepared.length; i += opts.batchSize) {
    const batch = prepared.slice(i, i + opts.batchSize);
    for (const record of batch) {
      const { data: existing } = await supabase
        .from('faculty_quotes')
        .select('id, status')
        .eq('faculty_id', record.faculty_id)
        .eq('quote_text', record.quote_text)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabase
          .from('faculty_quotes')
          .update({
            tags: record.tags,
            notes: record.notes,
            epub_locator: record.epub_locator,
            source: record.source,
            source_id: record.source_id,
            book_author: record.book_author,
          })
          .eq('id', existing.id);
        if (error) {
          console.error('update', record.faculty_id, error.message);
          failed += 1;
        } else updated += 1;
      } else {
        const { error } = await supabase.from('faculty_quotes').insert(record);
        if (error) {
          console.error('insert', record.faculty_id, error.message);
          failed += 1;
        } else inserted += 1;
      }
    }
    process.stdout.write(`\r  ${Math.min(i + opts.batchSize, prepared.length)}/${prepared.length}`);
  }
  console.log(`\nDone. inserted=${inserted} updated=${updated} failed=${failed}`);
  console.log('Next: npm run embed   # vectorize new drafts');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
