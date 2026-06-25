// Ticker normalization + validation. Keeps the AI from inventing symbols or fusing
// two tickers: a candidate must match the symbol grammar AND either be a well-known
// instrument or resolve to a real quote (reuses lib/markets getQuote — no new feed).

import { getQuote } from "@/lib/markets";

// Common index/ETF/future/crypto aliases the videos use, mapped to a canonical symbol.
const ALIASES: Record<string, string> = {
  SPX: "SPY",
  "S&P": "SPY",
  "S&P500": "SPY",
  NASDAQ: "QQQ",
  NDX: "QQQ",
  RUSSELL: "IWM",
  RUT: "IWM",
  DOW: "DIA",
  NQ: "NQ",
  ES: "ES",
  RTY: "IWM",
  YM: "DIA",
  BTC: "BTC",
  BITCOIN: "BTC",
  ETH: "ETH",
  ETHEREUM: "ETH",
  VIX: "VIX",
  TENYEAR: "TNX",
  "10Y": "TNX",
};

// Instruments we always accept (indices/futures/macro that getQuote may not price cleanly).
const KNOWN = new Set([
  "SPY", "QQQ", "IWM", "DIA", "NQ", "ES", "RTY", "YM", "VIX", "TNX", "BTC", "ETH",
  "GLD", "SLV", "USO", "TLT", "HYG", "UVXY", "SQQQ", "TQQQ",
]);

/** Pull candidate ticker symbols out of free text. Conservative — favors precision. */
export function extractTickerCandidates(text: string): string[] {
  const out = new Set<string>();
  // $TSLA style — highest confidence.
  for (const m of text.matchAll(/\$([A-Za-z]{1,5})\b/g)) out.add(m[1].toUpperCase());
  // Bare 1-5 letter all-caps tokens (NVDA, SPY) — filtered by validation later.
  for (const m of text.matchAll(/\b([A-Z]{2,5})\b/g)) out.add(m[1].toUpperCase());
  // Common lowercase macro words → aliases.
  for (const w of Object.keys(ALIASES)) {
    if (new RegExp(`\\b${w.replace(/[&]/g, "\\$&")}\\b`, "i").test(text)) out.add(w.toUpperCase());
  }
  return [...out];
}

export function normalizeTicker(raw: string): string {
  const s = (raw || "").trim().toUpperCase().replace(/^\$/, "");
  return ALIASES[s] ?? s;
}

const SYMBOL_RE = /^[A-Z]{1,5}([.\-][A-Z]{1,4})?$/;

/** Shape check only (no network). */
export function isPlausibleSymbol(sym: string): boolean {
  const s = normalizeTicker(sym);
  if (!s || s.length > 6) return false;
  if (KNOWN.has(s)) return true;
  return SYMBOL_RE.test(s);
}

/** Validate a symbol resolves to a real instrument (known list, or a live quote).
 *  Used to drop AI-invented tickers. Caches within a request via the markets cache. */
export async function validateTicker(sym: string): Promise<{ ok: boolean; symbol: string }> {
  const symbol = normalizeTicker(sym);
  if (!isPlausibleSymbol(symbol)) return { ok: false, symbol };
  if (KNOWN.has(symbol)) return { ok: true, symbol };
  try {
    const q = await getQuote(symbol);
    return { ok: !!q, symbol };
  } catch {
    return { ok: false, symbol };
  }
}

/** Validate a batch, returning the set that resolved. Bounded concurrency. */
export async function filterValidTickers(syms: string[]): Promise<string[]> {
  const unique = [...new Set(syms.map(normalizeTicker))].slice(0, 40);
  const results = await Promise.all(unique.map((s) => validateTicker(s)));
  return results.filter((r) => r.ok).map((r) => r.symbol);
}
