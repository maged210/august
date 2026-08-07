// Shared pure derivations for the terminal desk (G3) — used by the blotter
// (IdeasFeed) and the dock modules alike, so the SIDE/symbol logic can never
// drift between the grid and the chart.

import type { PublicIdea } from "@/lib/ideas";

/** first numeral in a free-form level string ("21,450" / "break of 600") */
export function numOf(s: string): number | null {
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) ? v : null;
}

/** SIDE derived from entry vs target numerals — the model stores no direction,
 *  so callers render this in the derived style; null when not derivable (∅) */
export function liveSide(idea: PublicIdea): "LONG" | "SHORT" | null {
  const e = numOf(idea.entry);
  const t = numOf(idea.target);
  if (e == null || t == null || e === t) return null;
  return t > e ? "LONG" : "SHORT";
}

// Desk shorthand → Yahoo chart symbol, for the chart/pulse ONLY (the server's
// normalizeYahooSymbol handles crypto; futures/index shorthands would pass
// through to the wrong listing). Deliberately NOT applied to the quote paths
// the desk already uses — this maps for charts without changing any existing
// behavior.
const CHART_SYM: Record<string, string> = {
  NQ: "NQ=F",
  ES: "ES=F",
  YM: "YM=F",
  RTY: "RTY=F",
  CL: "CL=F",
  GC: "GC=F",
  SI: "SI=F",
  NG: "NG=F",
  SPX: "^GSPC",
  NDX: "^NDX",
  DJI: "^DJI",
  VIX: "^VIX",
  DXY: "DX-Y.NYB",
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  DOGE: "DOGE-USD",
  XRP: "XRP-USD",
};

export function chartSymbolFor(ticker: string): string {
  const s = ticker.trim().toUpperCase();
  return CHART_SYM[s] ?? s;
}
