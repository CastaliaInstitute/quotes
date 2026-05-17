#!/usr/bin/env node
/**
 * Build static quote-of-the-day artifacts for GitHub Pages (docs/).
 * Uses data/quotes.json if present, else data/seed-quotes.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readestUrl } from './lib/readest-url.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const docsDir = join(root, 'docs');

function loadQuotes() {
  const primary = join(root, 'data', 'quotes.json');
  const fallback = join(root, 'data', 'seed-quotes.json');
  const path = [primary, fallback].find((p) => {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!path) throw new Error('No quotes data found');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function dayIndex(length) {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayOfYear = Math.floor((today - start) / 86400000);
  return dayOfYear % length;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPayload(quotes) {
  const index = dayIndex(quotes.length);
  const raw = quotes[index];
  const date = new Date().toISOString().slice(0, 10);
  return {
    date,
    index,
    total: quotes.length,
    quote: {
      ...raw,
      readest_url: readestUrl(raw),
    },
  };
}

function buildHtml(payload) {
  const q = payload.quote;
  const readest = q.readest_url
    ? `<p><a href="${escapeHtml(q.readest_url)}">Open in Bibliotech Readest</a></p>`
    : q.source && q.source_id
      ? `<p class="meta">Bibliotech link pending — corpus <code>${escapeHtml(q.source)}://${escapeHtml(q.source_id)}</code></p>`
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Quote of the day — Castalia Quotes</title>
  <link rel="alternate" type="application/json" href="/quote-of-the-day.json" />
  <style>
    :root { color-scheme: light dark; --ink: #1a1a1a; --paper: #f7f4ef; --accent: #5c4d3c; }
    @media (prefers-color-scheme: dark) {
      :root { --ink: #ece7df; --paper: #141210; --accent: #c9b89a; }
    }
    body { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      background: var(--paper); color: var(--ink); margin: 0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 2rem; }
    main { max-width: 40rem; }
    blockquote { font-size: 1.35rem; line-height: 1.55; margin: 0 0 1.25rem; border: none; }
    cite { font-style: normal; opacity: 0.85; }
    .meta { font-size: 0.9rem; opacity: 0.75; }
    a { color: var(--accent); }
    footer { margin-top: 2rem; font-size: 0.85rem; opacity: 0.7; }
  </style>
</head>
<body>
  <main>
    <p class="meta">Quote of the day · ${escapeHtml(payload.date)}</p>
    <blockquote>
      <p>${escapeHtml(q.quote_text)}</p>
      <cite>— ${escapeHtml(q.book_author || q.faculty_id)}${q.passage_label ? `, <em>${escapeHtml(q.passage_label)}</em>` : ''}</cite>
    </blockquote>
    ${readest}
    <footer>
      <a href="/">Castalia Quotes</a> ·
      <a href="/quote-of-the-day.json">JSON</a>
    </footer>
  </main>
</body>
</html>
`;
}

const quotes = loadQuotes();
const payload = buildPayload(quotes);

mkdirSync(docsDir, { recursive: true });
writeFileSync(join(docsDir, 'quote-of-the-day.json'), JSON.stringify(payload, null, 2) + '\n');
writeFileSync(join(docsDir, 'quote-of-the-day.html'), buildHtml(payload));
console.log(`Wrote quote of the day (${payload.date}): ${payload.quote.faculty_id}`);
