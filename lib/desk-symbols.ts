// Desk shorthand → Yahoo chart symbol. PURE, shared by the client desk
// (charts/pulse/heatmap via components/surfaces/dock/derive.ts) and the
// server's daily book pass (lib/ideas-eval.ts) — one table, so an idea on
// "NQ" or "CL" is charted AND evaluated against the instrument the desk
// means, never Colgate-Palmolive's listing. The server's normalizeYahooSymbol
// handles crypto only; futures/index shorthands would otherwise pass through
// to the wrong listing.

const DESK_SYM: Record<string, string> = {
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

export function deskSymbolFor(ticker: string): string {
  const s = ticker.trim().toUpperCase();
  return DESK_SYM[s] ?? s;
}
