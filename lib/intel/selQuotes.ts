// AUGUST Market Intel — selection quotes (pure logic).
//
// The board's 30s poll quotes ONLY today's brief ∪ live tracked tickers
// (≤20 symbols, and setQuotes REPLACES the map wholesale every tick). Rows
// outside that set — past-day boards, briefs with >20 symbols — would starve
// the inspector forever. The fix: selecting such a row fetches its ONE symbol
// via the existing GET /api/intel/quotes into a SEPARATE map that is merged
// at read time, so the poll's wholesale replacement can never clobber it.
//
// This module is the pure core (LRU map, freshness, merge, and the inspector
// view-state contract) so the honesty rules are unit-testable without React:
// a quote-loading treatment may render ONLY while a fetch is genuinely in
// flight — it always resolves to either the full inspector or the ∅
// null-quote body (HONESTY LAW: never a permanent fake loading state).

export type SelQuoteEntry<Q> = { quote: Q; at: number };
export type SelQuoteMap<Q> = Map<string, SelQuoteEntry<Q>>;

/** LRU bound — mirrors the quotes endpoint's 20-symbol contract. */
export const SEL_QUOTE_CAP = 20;
/** Re-selecting a row whose selection quote is older than this refetches
 *  (the server's own quote cache TTL is 60s — matching it means a refetch
 *  can actually return fresher data). */
export const SEL_QUOTE_STALE_MS = 60_000;

/** Insert/refresh one selection quote. Immutable — returns a new Map with
 *  the symbol re-inserted last (Map iteration order = insertion order, so
 *  the FIRST key is always the least-recently-written) and the oldest
 *  entries evicted past `cap`. */
export function selQuoteUpsert<Q>(
  map: SelQuoteMap<Q>,
  symbol: string,
  quote: Q,
  at: number,
  cap: number = SEL_QUOTE_CAP,
): SelQuoteMap<Q> {
  const sym = symbol.toUpperCase();
  const next = new Map(map);
  next.delete(sym); // re-insert = most recent
  next.set(sym, { quote, at });
  while (next.size > cap) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

/** True when the map holds a NON-STALE entry for the symbol — a fresh entry
 *  means selection needs no refetch. */
export function selQuoteFresh<Q>(
  map: SelQuoteMap<Q>,
  symbol: string,
  now: number,
  staleMs: number = SEL_QUOTE_STALE_MS,
): boolean {
  const e = map.get(symbol.toUpperCase());
  return !!e && now - e.at <= staleMs;
}

/** Merge for the READ path: poll quotes win (they are refreshed every 30s),
 *  selection quotes fill the symbols the ≤20-symbol poll can't carry. Called
 *  per render, so the poll's wholesale `setQuotes(j.quotes)` replacement
 *  never erases a selection quote — it only ever shadows it with fresher
 *  data for the same symbol. */
export function mergeQuotes<Q>(
  poll: Record<string, Q>,
  sel: SelQuoteMap<Q>,
): Record<string, Q> {
  if (sel.size === 0) return poll;
  const out: Record<string, Q> = {};
  for (const [sym, e] of sel) out[sym] = e.quote;
  Object.assign(out, poll); // poll wins on overlap
  return out;
}

/** Inspector body contract for a selected row:
 *  - "full"    → a quote exists (merged read) — the full inspector renders;
 *  - "loading" → no quote AND a selection fetch is genuinely in flight —
 *                the ONLY state allowed to render a loading treatment, and
 *                it resolves by construction (the fetch settles into either
 *                a quote or a failure);
 *  - "noquote" → no quote and nothing in flight (fetch failed or returned
 *                empty) — the ∅ null-quote inspector body renders: thesis,
 *                levels, lifecycle, evidence and the PUBLISH control, with
 *                the live-price block absent-treated + RETRY QUOTE. */
export type InspectorQuoteView = "full" | "loading" | "noquote";
export function inspectorQuoteView(hasQuote: boolean, fetchInFlight: boolean): InspectorQuoteView {
  if (hasQuote) return "full";
  return fetchInFlight ? "loading" : "noquote";
}
