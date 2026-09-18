"use client";

// THE QUOTE BOOK LOOP (feat/v4-2-today) — the one client loop behind every
// price on screen, moved out of components/surfaces/IdeasFeed.tsx so the front
// page and the terminal run the same code (lib/quote-book.ts holds the pure
// policy). Behaviour is the v4-1b loop, unchanged:
//   - the symbols are asked in ≤20-symbol chunks (the route's cap);
//   - every chunk merges ON ITS OWN, stamped with the time its round was
//     ASKED, so a slow batch never holds the rest at "loading", a batch that
//     hangs past the timeout is a failed batch (UNAVAILABLE on its own
//     symbols), and an older round landing late is dropped;
//   - a tick each poll re-reads freshness even when no round has landed, and
//     a tab coming back re-asks at once.
// `closes: true` keeps the spark closes in the caller's own parallel map
// (the front page's regime needs them; the terminal never asks).

import { useCallback, useEffect, useState } from "react";
import {
  QUOTE_MAX_AGE_MS,
  QUOTE_REFRESH_MS,
  QUOTE_TIMEOUT_MS,
  chunkSymbols,
  mergeQuoteRound,
  mergeRoundCloses,
  readCloses,
  readQuote,
  type QuoteBatch,
  type QuoteBook,
  type QuoteCloses,
  type QuoteRead,
} from "@/lib/quote-book";

export type QuoteReader = {
  /** ONE reader for every surface that shows a price from the book */
  quoteFor: (symbol: string) => QuoteRead;
  /** the spark closes behind a FRESH price (null unless opts.closes) */
  closesFor: (symbol: string) => number[] | null;
};

export function useQuoteBook(symbols: readonly string[], opts: { closes?: boolean } = {}): QuoteReader {
  const withCloses = opts.closes === true;
  const [quotes, setQuotes] = useState<QuoteBook>({});
  const [closes, setCloses] = useState<QuoteCloses>({});
  const [tick, setTick] = useState(0);

  const symKey = chunkSymbols(symbols)
    .map((c) => c.join(","))
    .join("|");
  useEffect(() => {
    if (!symKey) return;
    const chunks = symKey.split("|");
    let cancelled = false;
    const inflight = new Set<AbortController>();
    const pull = () => {
      const askedAt = Date.now();
      for (const c of chunks) {
        const ctl = new AbortController();
        inflight.add(ctl);
        const timer = window.setTimeout(() => ctl.abort(), QUOTE_TIMEOUT_MS);
        fetch(`/api/intel/quotes?symbols=${encodeURIComponent(c)}`, { cache: "no-store", signal: ctl.signal })
          .then(async (r) => {
            if (!r.ok) throw new Error(String(r.status));
            // the server's own clock at send time — every asOf in this
            // response is on that timeline (fix/quote-age)
            const serverNow = Date.parse(r.headers.get("date") ?? "");
            const j = (await r.json()) as { quotes?: QuoteBatch["quotes"] };
            return { j, serverNow };
          })
          .then(
            ({ j, serverNow }): QuoteBatch => ({
              symbols: c.split(","),
              ok: true,
              quotes: j.quotes ?? {},
              serverNow: Number.isFinite(serverNow) ? serverNow : undefined,
            }),
            (): QuoteBatch => ({ symbols: c.split(","), ok: false }),
          )
          .then((batch) => {
            window.clearTimeout(timer);
            inflight.delete(ctl);
            if (cancelled) return;
            // a failed batch nulls exactly its symbols (UNAVAILABLE), an
            // answered one refreshes exactly its own
            setQuotes((prev) => mergeQuoteRound(prev, [batch], askedAt));
            if (withCloses) setCloses((prev) => mergeRoundCloses(prev, batch, askedAt));
          });
      }
    };
    pull();
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      if (!document.hidden) pull();
    }, QUOTE_REFRESH_MS);
    // a tab coming back re-asks at once, so a price that aged out while the
    // poll was paused is replaced within a round-trip instead of a minute
    const onVisible = () => {
      if (!document.hidden) {
        setTick((t) => t + 1);
        pull();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      for (const ctl of inflight) ctl.abort();
    };
  }, [symKey, withCloses]);

  const quoteFor = useCallback(
    (symbol: string): QuoteRead => readQuote(quotes, symbol, Date.now(), QUOTE_MAX_AGE_MS),
    // tick re-reads freshness every poll even when no round has landed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quotes, tick],
  );
  const closesFor = useCallback(
    (symbol: string): number[] | null => readCloses(closes, symbol, quoteFor(symbol)),
    [closes, quoteFor],
  );
  return { quoteFor, closesFor };
}
