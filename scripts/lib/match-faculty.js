import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './load-env.js';

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyToken(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** @param {string} author */
export function parseAuthorSurnames(author) {
  const raw = author.trim();
  if (!raw) return [];

  if (raw.includes(',')) {
    const head = raw.split(',')[0].trim();
    const parts = head.split(/\s+/).filter(Boolean);
    const candidates = [slugifyToken(parts[parts.length - 1] || head), slugifyToken(head.replace(/\s+/g, ''))];
    return [...new Set(candidates.filter(Boolean))];
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const last = slugifyToken(parts[parts.length - 1]);
  const firstLast = slugifyToken(parts[0] + parts[parts.length - 1]);
  return [...new Set([last, firstLast].filter(Boolean))];
}

/**
 * @param {{ id: string, name: string, slug: string, public_domain?: boolean }[]} facultyRows
 * @param {Record<string, string>} [aliasMap]
 */
export function buildFacultyMatcher(facultyRows, aliasMap = {}) {
  const byId = new Map();
  const byNormName = new Map();
  const bySlug = new Map();

  for (const f of facultyRows) {
    byId.set(f.id, f);
    const norm = normalize(f.name);
    if (norm && !byNormName.has(norm)) byNormName.set(norm, f.id);
    const slug = slugifyToken(f.slug || f.id.replace(/^a\./, ''));
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(f.id);
  }

  let fileAliases = {};
  try {
    fileAliases = JSON.parse(readFileSync(join(root, 'data', 'author-aliases.json'), 'utf8'));
  } catch {
    /* optional */
  }
  const aliases = { ...fileAliases, ...aliasMap };

  /**
   * @returns {{ facultyId: string | null, reason: string }}
   */
  function matchAuthor(author) {
    if (!author?.trim()) return { facultyId: null, reason: 'empty' };

    if (aliases[author]) {
      const id = aliases[author];
      return byId.has(id)
        ? { facultyId: id, reason: 'alias-exact' }
        : { facultyId: null, reason: 'alias-missing-faculty' };
    }

    const normAuthor = normalize(author);
    if (byNormName.has(normAuthor)) {
      return { facultyId: byNormName.get(normAuthor), reason: 'name-exact' };
    }

    const surnames = parseAuthorSurnames(author);
    for (const s of surnames) {
      const directId = `a.${s}`;
      if (byId.has(directId)) return { facultyId: directId, reason: 'id-surname' };

      const ids = bySlug.get(s);
      if (ids?.length === 1) return { facultyId: ids[0], reason: 'slug-unique' };
      if (ids && ids.length > 1) {
        const pd = ids.find((id) => byId.get(id)?.public_domain === true);
        if (pd) return { facultyId: pd, reason: 'slug-pd-pick' };
        return { facultyId: null, reason: `slug-ambiguous:${s}` };
      }
    }

    return { facultyId: null, reason: 'no-match' };
  }

  return { matchAuthor, byId };
}

export async function loadAllFaculty(supabase) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('faculty')
      .select('id, name, slug, public_domain')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}
