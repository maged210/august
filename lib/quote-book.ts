// THE QUOTE BOOK (feat/v4-2-today) — ONE freshness policy for every surface
// that shows a price: the terminal's cards + dock heatmap AND the front page's
// regime, pulse and WATCHING strip. Moved here verbatim from lib/idea-card.ts
// (feat/v4-1b-integrity) so both surfaces import the same code: two copies of
// the same logic is how the stop-regex bug happened. Pure — no network, no
// React; the client loop that feeds it is lib/use-quote-book.ts.
//
// Per SYMBOL, not per round: each slot carries its own last-seen time and the
// time its batch was last asked. A symbol is fresh only when the latest
// attempt that included it answered with a price, and that answer is recent.
// A failed batch nulls its symbols' prices — an older round's price is never
// kept around to be mistaken for a fresh one.

/** the book, the tape and the quotes poll together */
export const QUOTE_REFRESH_MS = 60_000;
/** a symbol answered longer ago than this reads UNAVAILABLE even if no newer
 *  round has failed — a stalled poll (a hidden tab) must not keep a price
 *  standing as DELAYED */
export const QUOTE_MAX_AGE_MS = 3 * QUOTE_REFRESH_MS;
/** a quotes batch still out after this is a failed batch — its symbols read
 *  UNAVAILABLE instead of sitting on "loading" until the platform times out */
export const QUOTE_TIMEOUT_MS = 20_000;

/** quotes are fetched in chunks the route accepts (20 symbols per call);
 *  a longer book must never silently lose its tail */
export function chunkSymbols(symbols: readonly string[], size = 20): string[][] {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  const out: string[][] = [];
  for (let i = 0; i < uniq.length; i += size) out.push(uniq.slice(i, i + size));
  return out;
}

export type QuoteSlot = {
  price: number | null;
  /** today's % move, when the route carried one */
  chgPct: number | null;
  /** when this symbol last came back with a price (epoch ms) */
  seenAt: number | null;
  /** when this symbol's batch was last asked, answered or not (epoch ms) */
  checkedAt: number;
};
export type QuoteBook = Record<string, QuoteSlot>;
/** one chunk's outcome: ok=false when the request itself failed */
export type QuoteBatch = {
  symbols: readonly string[];
  ok: boolean;
  quotes?: Record<string, { price?: number; chgPct?: number; closes?: number[] } | undefined>;
};

/** `now` is when the batch was ASKED (feat/v4-1b-integrity), not when it
 *  landed: batches merge one at a time as they settle, so a slow batch never
 *  holds the rest of the book back, and a batch from an OLDER round that lands
 *  after a newer round has already asked for a symbol is dropped for that
 *  symbol — an older round's price can never overwrite a newer answer (or a
 *  newer failure) and be stamped fresh. */
export function mergeQuoteRound(prev: QuoteBook, batches: readonly QuoteBatch[], now: number): QuoteBook {
  const next: QuoteBook = { ...prev };
  for (const b of batches) {
    for (const raw of b.symbols) {
      const sym = raw.trim().toUpperCase();
      if (prev[sym] && prev[sym].checkedAt > now) continue; // a newer round already asked — this one is history
      const q = b.ok ? b.quotes?.[sym] : undefined;
      const price = q && Number.isFinite(q.price) && (q.price as number) > 0 ? (q.price as number) : null;
      if (price != null) {
        next[sym] = { price, chgPct: Number.isFinite(q!.chgPct) ? (q!.chgPct as number) : null, seenAt: now, checkedAt: now };
      } else {
        // the batch failed, or answered without this symbol: no price at all
        next[sym] = { price: null, chgPct: null, seenAt: prev[sym]?.seenAt ?? null, checkedAt: now };
      }
    }
  }
  return next;
}

export type QuoteRead =
  | { state: "pending" }
  | { state: "ok"; price: number; chgPct: number | null; seenAt: number }
  | { state: "unavailable"; seenAt: number | null };

/** pending: never asked yet · ok: answered by its latest attempt, within
 *  maxAgeMs (a poll that stalls — a hidden tab — ages a price out) ·
 *  unavailable: everything else */
export function readQuote(book: QuoteBook, symbol: string, now: number, maxAgeMs: number): QuoteRead {
  const slot = book[symbol.trim().toUpperCase()];
  if (!slot) return { state: "pending" };
  if (slot.price != null && slot.seenAt != null && slot.seenAt === slot.checkedAt && now - slot.seenAt <= maxAgeMs) {
    return { state: "ok", price: slot.price, chgPct: slot.chgPct, seenAt: slot.seenAt };
  }
  return { state: "unavailable", seenAt: slot.seenAt };
}

// ── the price HISTORY a surface may keep beside the book ────────────────────
//
// The front page's regime needs the 1mo spark closes the quotes route already
// sends (INDEX TREND, VIX TREND). The book deliberately holds prices only, so a
// surface that wants closes keeps them in its OWN parallel map, stamped with
// the same ask time as the slot. Closes are only ever read through a price the
// book says is fresh AND from the very answer that price came from — a failed
// or aged-out symbol loses its history exactly when it loses its price.

export type QuoteCloses = Record<string, { closes: number[]; at: number }>;

/** merge one batch's closes, stamped with the round's ASK time; the same
 *  older-round rule as mergeQuoteRound */
export function mergeRoundCloses(prev: QuoteCloses, batch: QuoteBatch, now: number): QuoteCloses {
  if (!batch.ok) return prev;
  let next: QuoteCloses | null = null;
  for (const raw of batch.symbols) {
    const sym = raw.trim().toUpperCase();
    if (prev[sym] && prev[sym].at > now) continue;
    const closes = batch.quotes?.[sym]?.closes;
    if (!Array.isArray(closes)) continue;
    const clean = closes.filter((c) => Number.isFinite(c));
    if (!next) next = { ...prev };
    next[sym] = { closes: clean, at: now };
  }
  return next ?? prev;
}

/** closes for a symbol ONLY when its price reads fresh and both came from the
 *  same answer; null otherwise */
export function readCloses(closes: QuoteCloses, symbol: string, read: QuoteRead): number[] | null {
  if (read.state !== "ok") return null;
  const entry = closes[symbol.trim().toUpperCase()];
  return entry && entry.at === read.seenAt ? entry.closes : null;
}
