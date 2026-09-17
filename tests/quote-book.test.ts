// lib/quote-book — the ONE per-symbol freshness policy behind every price on
// screen (terminal cards + dock heatmap, and since feat/v4-2-today the front
// page's regime, pulse and WATCHING strip). Moved verbatim from
// idea-card.test.ts with the functions; the closes tests are new.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chunkSymbols,
  mergeQuoteRound,
  mergeRoundCloses,
  readCloses,
  readQuote,
  type QuoteBook,
  type QuoteCloses,
} from "../lib/quote-book";

const T0 = 1_757_800_000_000; // 2025-09-13T22:13:20Z — a fixed clock
test("chunkSymbols: dedupes, uppercases, sorts, and never exceeds the route's 20-symbol cap", () => {
  const syms = Array.from({ length: 33 }, (_, i) => `s${i}`).concat(["S1", " s2 "]);
  const chunks = chunkSymbols(syms);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 20);
  assert.equal(chunks[1].length, 13);
  assert.deepEqual(chunkSymbols([]), []);
});

test("quotes: a failed batch makes exactly its own symbols UNAVAILABLE — never an older round's price", () => {
  const A = Array.from({ length: 20 }, (_, i) => `S${String(i).padStart(2, "0")}`);
  const B = ["T00", "T01", "T02"];
  const priced = (syms: string[], px: number) => Object.fromEntries(syms.map((s) => [s, { price: px, chgPct: 1.5 }]));
  const MAX = 180_000;
  // round 1: both batches answer
  let book: QuoteBook = mergeQuoteRound({}, [{ symbols: A, ok: true, quotes: priced(A, 10) }, { symbols: B, ok: true, quotes: priced(B, 20) }], T0);
  assert.deepEqual(readQuote(book, "T01", T0, MAX), { state: "ok", price: 20, chgPct: 1.5, seenAt: T0 });
  // round 2: batch A answers, batch B fails (the heatmap's silent tail)
  const t2 = T0 + 60_000;
  book = mergeQuoteRound(book, [{ symbols: A, ok: true, quotes: priced(A, 11) }, { symbols: B, ok: false }], t2);
  assert.equal(readQuote(book, "S05", t2, MAX).state, "ok");
  const b = readQuote(book, "T01", t2, MAX);
  assert.equal(b.state, "unavailable");
  assert.equal(book.T01.price, null); // the round-1 price is gone, not kept around
  assert.equal(book.T01.seenAt, T0); // its own last-seen time survives
  // an answered batch that omits a symbol: that symbol alone is unavailable
  book = mergeQuoteRound(book, [{ symbols: ["X1", "X2"], ok: true, quotes: { X1: { price: 5 } } }], t2);
  assert.equal(readQuote(book, "X1", t2, MAX).state, "ok");
  assert.equal(readQuote(book, "x2", t2, MAX).state, "unavailable");
  // a symbol never asked is pending, not unavailable
  assert.equal(readQuote(book, "NEVER", t2, MAX).state, "pending");
  // a stalled poll ages a price out even though no round failed
  assert.equal(readQuote(book, "S05", t2 + MAX + 1, MAX).state, "unavailable");
  // the next good round restores it
  const t3 = t2 + 60_000;
  book = mergeQuoteRound(book, [{ symbols: B, ok: true, quotes: priced(B, 21) }], t3);
  assert.equal(readQuote(book, "T01", t3, MAX).state, "ok");
  // a non-positive or missing price is no price
  book = mergeQuoteRound(book, [{ symbols: ["Z"], ok: true, quotes: { Z: { price: 0 } } }], t3);
  assert.equal(readQuote(book, "Z", t3, MAX).state, "unavailable");
  // an answer without a % keeps chgPct null (the heatmap says so rather than shading zero)
  book = mergeQuoteRound(book, [{ symbols: ["P"], ok: true, quotes: { P: { price: 3 } } }], t3);
  const p = readQuote(book, "P", t3, MAX);
  assert.equal(p.state === "ok" ? p.chgPct : "x", null);
});

test("quotes: batches merge as they land — an OLDER round landing late never overwrites a newer answer", () => {
  const MAX = 180_000;
  const t1 = T0;
  const t2 = T0 + 60_000;
  // round 2 (asked at t2) lands first
  let book: QuoteBook = mergeQuoteRound({}, [{ symbols: ["AGI", "SEDG"], ok: true, quotes: { AGI: { price: 35.4, chgPct: 0.3 }, SEDG: { price: 34.9 } } }], t2);
  // round 1 (asked at t1) lands late, with older prices: dropped per symbol
  book = mergeQuoteRound(book, [{ symbols: ["AGI", "SEDG"], ok: true, quotes: { AGI: { price: 34.1 }, SEDG: { price: 33 } } }], t1);
  assert.deepEqual(readQuote(book, "AGI", t2, MAX), { state: "ok", price: 35.4, chgPct: 0.3, seenAt: t2 });
  assert.equal(book.SEDG.price, 34.9);
  // a newer FAILURE is not resurrected by an older success landing late
  book = mergeQuoteRound(book, [{ symbols: ["AGI"], ok: false }], t2 + 60_000);
  book = mergeQuoteRound(book, [{ symbols: ["AGI"], ok: true, quotes: { AGI: { price: 36 } } }], t2);
  assert.equal(readQuote(book, "AGI", t2 + 60_000, MAX).state, "unavailable");
  assert.equal(book.AGI.price, null);
  // sibling batches of ONE round (same ask time) merge independently
  const t4 = t2 + 120_000;
  book = mergeQuoteRound(book, [{ symbols: ["AGI"], ok: true, quotes: { AGI: { price: 36.2 } } }], t4);
  book = mergeQuoteRound(book, [{ symbols: ["SEDG"], ok: false }], t4);
  assert.equal(readQuote(book, "AGI", t4, MAX).state, "ok");
  assert.equal(readQuote(book, "SEDG", t4, MAX).state, "unavailable");
  // a symbol never asked before merges whatever its round
  book = mergeQuoteRound(book, [{ symbols: ["NEW"], ok: true, quotes: { NEW: { price: 1 } } }], t1);
  assert.equal(book.NEW.price, 1);
});

test("closes: kept beside the book, read only through a FRESH price from the same answer", () => {
  const MAX = 180_000;
  const t1 = T0;
  const t2 = T0 + 60_000;
  const ok = { symbols: ["SPY", "^VIX"], ok: true, quotes: { SPY: { price: 500, chgPct: 0.2, closes: [490, 495, 500] }, "^VIX": { price: 17 } } };
  let book: QuoteBook = mergeQuoteRound({}, [ok], t1);
  let closes: QuoteCloses = mergeRoundCloses({}, ok, t1);
  assert.deepEqual(readCloses(closes, "spy", readQuote(book, "SPY", t1, MAX)), [490, 495, 500]);
  // a symbol answered without closes has none — never a borrowed series
  assert.equal(readCloses(closes, "^VIX", readQuote(book, "^VIX", t1, MAX)), null);
  // the next round FAILS: the price goes unavailable and takes its history with it
  const fail = { symbols: ["SPY", "^VIX"], ok: false };
  book = mergeQuoteRound(book, [fail], t2);
  closes = mergeRoundCloses(closes, fail, t2);
  assert.equal(readQuote(book, "SPY", t2, MAX).state, "unavailable");
  assert.equal(readCloses(closes, "SPY", readQuote(book, "SPY", t2, MAX)), null);
  // an aged-out price reads no history either
  const b3 = mergeQuoteRound({}, [ok], t1);
  assert.equal(readCloses(mergeRoundCloses({}, ok, t1), "SPY", readQuote(b3, "SPY", t1 + MAX + 1, MAX)), null);
  // an OLDER round landing late never replaces a newer round's closes
  const newer = { symbols: ["SPY"], ok: true, quotes: { SPY: { price: 510, closes: [500, 510] } } };
  const older = { symbols: ["SPY"], ok: true, quotes: { SPY: { price: 480, closes: [470, 480] } } };
  let c = mergeRoundCloses({}, newer, t2);
  c = mergeRoundCloses(c, older, t1);
  let bk = mergeQuoteRound({}, [newer], t2);
  bk = mergeQuoteRound(bk, [older], t1);
  assert.deepEqual(readCloses(c, "SPY", readQuote(bk, "SPY", t2, MAX)), [500, 510]);
});
