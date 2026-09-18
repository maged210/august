// THE QUOTE BOOK (feat/v4-2-today) — ONE freshness policy for every surface
// that shows a price: the terminal's cards + dock heatmap AND the front page's
// regime, pulse and WATCHING strip. Moved here verbatim from lib/idea-card.ts
// (feat/v4-1b-integrity) so both surfaces import the same code: two copies of
// the same logic is how the stop-regex bug happened. Pure — no network, no
// React; the client loop that feeds it is lib/use-quote-book.ts.
//
// Per SYMBOL, not per round: each slot carries the time its batch was last
// asked, the round that answered it, and — since fix/quote-age — the price's
// OWN as-of time from the route. A symbol is fresh only when the latest
// attempt that included it answered with a price AND that price is recent BY
// ITS OWN AGE. The route's 60s cache (and its serve-stale-on-error path) means
// an answer that arrives now can carry a price from minutes ago: arrival is
// never freshness. A failed batch nulls its symbols' prices — an older round's
// price is never kept around to be mistaken for a fresh one.

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
  /** when this price came off the wire, on the CLIENT's clock (the route's
   *  per-quote asOf, aligned by alignAsOf) — the one basis for freshness */
  asOf: number | null;
  /** which round answered this symbol with a price (epoch ms, the ask time) */
  seenAt: number | null;
  /** when this symbol's batch was last asked, answered or not (epoch ms) */
  checkedAt: number;
};
export type QuoteBook = Record<string, QuoteSlot>;
/** one chunk's outcome: ok=false when the request itself failed */
export type QuoteBatch = {
  symbols: readonly string[];
  ok: boolean;
  quotes?: Record<string, { price?: number; chgPct?: number; closes?: number[]; asOf?: number } | undefined>;
  /** the server's clock when it answered (the response's Date header). Every
   *  asOf in this batch is on THAT timeline, so the merge translates it to the
   *  client's before storing — a device clock minutes off must not decide
   *  whether a price is stale. Absent = trust the timestamps as given. */
  serverNow?: number;
};

/** PURE. A quote's as-of time on the CLIENT's clock. The route stamps asOf on
 *  the server's clock and says what time it was there (the Date header), so
 *  the difference between the two clocks — not the price's age — is what this
 *  removes. Without a usable server time the stamp is taken as given. */
export function alignAsOf(asOf: number, serverNow: number | undefined, localNow: number): number {
  if (!Number.isFinite(asOf)) return NaN;
  if (serverNow === undefined || !Number.isFinite(serverNow)) return asOf;
  return asOf + (localNow - serverNow);
}

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
      // a price with no usable as-of time is a price of unknown age, and an
      // unknown age cannot be called fresh — it is no price at all
      const asOf = price != null ? alignAsOf(q!.asOf as number, b.serverNow, now) : NaN;
      if (price != null && Number.isFinite(asOf)) {
        next[sym] = {
          price,
          chgPct: Number.isFinite(q!.chgPct) ? (q!.chgPct as number) : null,
          asOf,
          seenAt: now,
          checkedAt: now,
        };
      } else {
        // the batch failed, or answered without this symbol (or without its
        // age): no price at all
        next[sym] = { price: null, chgPct: null, asOf: null, seenAt: prev[sym]?.seenAt ?? null, checkedAt: now };
      }
    }
  }
  return next;
}

export type QuoteRead =
  | { state: "pending" }
  | { state: "ok"; price: number; chgPct: number | null; asOf: number; seenAt: number }
  | { state: "unavailable"; seenAt: number | null };

/** pending: never asked yet · ok: answered by its latest attempt AND the price
 *  itself is younger than maxAgeMs (a 60s server cache, a stalled poll in a
 *  hidden tab, or a serve-stale-on-error hit all age a price out) ·
 *  unavailable: everything else */
export function readQuote(book: QuoteBook, symbol: string, now: number, maxAgeMs: number): QuoteRead {
  const slot = book[symbol.trim().toUpperCase()];
  if (!slot) return { state: "pending" };
  const answered = slot.price != null && slot.seenAt != null && slot.seenAt === slot.checkedAt;
  const age = slot.asOf != null ? now - slot.asOf : null;
  // a stamp from the near future is a clock, not a price: age 0, never a
  // negative age that could outlive the threshold in the other direction
  if (answered && age != null && Math.max(0, age) <= maxAgeMs) {
    return { state: "ok", price: slot.price as number, chgPct: slot.chgPct, asOf: slot.asOf as number, seenAt: slot.seenAt as number };
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
