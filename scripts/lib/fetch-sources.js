import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './load-env.js';

const CACHE_DIR = join(root, 'data', 'cache');

const SOURCES = {
  quotable: {
    url: 'https://raw.githubusercontent.com/quotable-io/data/master/data/quotes.json',
    cacheFile: 'quotable-quotes.json',
    parse(raw) {
      const rows = JSON.parse(raw);
      return rows.map((q) => ({
        external_id: q._id,
        quote_text: q.content?.trim(),
        book_author: q.author?.trim(),
        tags: (q.tags ?? []).map((t) =>
          t
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
        ),
        import_source: 'quotable',
      }));
    },
  },
  quotables: {
    url: 'https://raw.githubusercontent.com/alvations/Quotables/master/author-quote.txt',
    cacheFile: 'quotables-author-quote.txt',
    parse(raw) {
      return raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line, i) => {
          const tab = line.indexOf('\t');
          if (tab < 0) return null;
          const book_author = line.slice(0, tab).trim();
          const quote_text = line.slice(tab + 1).trim();
          return {
            external_id: `quotables-${i}`,
            quote_text,
            book_author,
            tags: ['imported', 'quotables', 'cc0'],
            import_source: 'quotables',
          };
        })
        .filter(Boolean);
    },
  },
};

export function listSources() {
  return Object.keys(SOURCES);
}

export async function fetchSource(sourceName, { refresh = false } = {}) {
  const spec = SOURCES[sourceName];
  if (!spec) throw new Error(`Unknown source "${sourceName}". Use: ${listSources().join(', ')}`);

  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, spec.cacheFile);

  let raw;
  if (!refresh && existsSync(cachePath)) {
    raw = readFileSync(cachePath, 'utf8');
  } else {
    const res = await fetch(spec.url);
    if (!res.ok) throw new Error(`Fetch ${spec.url} failed: ${res.status}`);
    raw = await res.text();
    writeFileSync(cachePath, raw);
  }

  return spec.parse(raw).filter((r) => r.quote_text && r.book_author);
}
