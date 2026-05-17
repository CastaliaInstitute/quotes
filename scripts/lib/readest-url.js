/**
 * Build Bibliotech Readest URL for a quote.
 * @param {{ book_id?: string | null, cfi?: string | null }} quote
 * @returns {string | null}
 */
export function readestUrl(quote) {
  if (!quote.book_id) return null;
  const base = `https://bibliotech.castalia.institute/read/?book=${quote.book_id}`;
  const cfi = quote.cfi?.trim();
  if (!cfi) return base;
  return `${base}&cfi=${encodeURIComponent(cfi)}`;
}
