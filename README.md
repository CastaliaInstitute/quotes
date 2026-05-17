# Castalia Quotes

Curated quotations by [Castalia](https://castalia.institute) faculty authors, linked to texts in [Bibliotech](https://bibliotech.castalia.institute/) with EPUB locators (CFI) for [Readest](https://bibliotech.castalia.institute/read/).

**Site:** [https://quotes.castalia.institute/](https://quotes.castalia.institute/)  
**Quote of the day:** [HTML](https://quotes.castalia.institute/quote-of-the-day.html) · [JSON](https://quotes.castalia.institute/quote-of-the-day.json)

## Supabase

Table **`faculty_quotes`** (Castalia Supabase project, shared with Bibliotech):

| Column | Purpose |
|--------|---------|
| `faculty_id` | `public.faculty.id` (e.g. `a.shakespeare`) |
| `book_id` | `public.books.id` when the EPUB is in corpus |
| `quote_text` | The quotation |
| `passage_label` | Human citation (act, chapter, poem) |
| `cfi` | EPUB Canonical Fragment Identifier for Readest |
| `epub_locator` | JSON fallback before CFI is resolved |
| `source` / `source_id` | Bibliotech catalog keys (`gutenberg`, id) |

View **`faculty_quotes_public`** adds `faculty_name` and `readest_url`.

Migration: [`supabase/migrations/20260517120000_create_faculty_quotes.sql`](supabase/migrations/20260517120000_create_faculty_quotes.sql) (also copied to `castalia.institute/supabase/migrations`).

### Seed famous quotes

```bash
cp ../castalia.institute/.env .env   # or export SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run seed:dry
npm run seed
```

Rows with matching `books.source` + `books.source_id` get `book_id` filled automatically.

### Resolve CFI in Readest

1. Open the book via `readest_url` (or Bibliotech library `?book=<uuid>`).
2. Navigate to the passage and copy the CFI from developer tools / note sync.
3. Update `faculty_quotes.cfi` so highlights deep-link correctly (`&cfi=` on the Readest URL is reserved for this).

## GitHub Pages

Static site in **`docs/`** with **`docs/CNAME`** = `quotes.castalia.institute`.

```bash
npm run build    # writes docs/quote-of-the-day.{json,html}
```

Enable **Pages → GitHub Actions** (workflow `pages.yml`). Daily cron rebuilds quote-of-the-day.

## DNS (Cloudflare)

DNS-only CNAME **`quotes`** → **`castaliainstitute.github.io`**:

```bash
set -a && source ../castalia.institute/.env && set +a
[[ -z "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_TOKEN:-}" ]] && export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_TOKEN"
npm run dns
```

Then in GitHub: **Settings → Pages → Custom domain** → `quotes.castalia.institute`.

## JSON shape (quote of the day)

```json
{
  "date": "2026-05-17",
  "index": 3,
  "total": 12,
  "quote": {
    "faculty_id": "a.woolf",
    "quote_text": "...",
    "passage_label": "...",
    "book_title": "...",
    "readest_url": "https://bibliotech.castalia.institute/read/?book=..."
  }
}
```
