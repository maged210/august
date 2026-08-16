// NQ LEVELS + VIX IN CONTEXT (COMMAND CENTER R2) — pure session math over
// bars the pipeline already fetches. HONESTY RULES: VWAP only when the
// intraday bars carry volume; overnight H/L only when timestamped bars
// actually cover the overnight session; everything else is null (rendered
// DATA UNAVAILABLE or omitted upstream — never approximated). The bias
// readout is a CALCULATED market condition from observable inputs — never
// advice.

import type { Candle, DailyBar } from "./markets";

export type SessionLevels = {
  price: number | null;
  prevHigh: number | null;
  prevLow: number | null;
  prevClose: number | null;
  /** classic pivot (prevH + prevL + prevC) / 3 */
  pivot: number | null;
  /** volume-weighted average of today's intraday bars; null without volume */
  vwap: number | null;
  /** overnight (outside 09:30–16:00 ET) session extremes; null when bars
   *  don't cover the overnight window */
  onHigh: number | null;
  onLow: number | null;
  /** unix seconds of the freshest intraday bar backing this read */
  asOf: number | null;
};

/** Minutes past midnight ET for a unix-seconds timestamp. */
export function etMinutes(tsSec: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(tsSec * 1000));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

const RTH_OPEN = 9 * 60 + 30; // 09:30 ET
const RTH_CLOSE = 16 * 60; // 16:00 ET

/** PURE. Compute the session levels from daily + intraday bars. */
export function computeLevels(daily: DailyBar[], intraday: Candle[]): SessionLevels {
  // previous COMPLETED daily bar — the last row is (usually) today's forming bar
  let prev: DailyBar | null = null;
  if (daily.length >= 2) prev = daily[daily.length - 2];
  else if (daily.length === 1) prev = daily[0];

  const last = intraday.length ? intraday[intraday.length - 1] : null;
  const price = last ? last.close : null;

  // VWAP — only over bars that genuinely carry volume
  let pv = 0;
  let vol = 0;
  for (const b of intraday) {
    if (!b.volume || b.volume <= 0) continue;
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * b.volume;
    vol += b.volume;
  }
  const vwap = vol > 0 ? pv / vol : null;

  // overnight extremes — bars OUTSIDE regular hours; needs real coverage
  let onHigh = -Infinity;
  let onLow = Infinity;
  let onBars = 0;
  for (const b of intraday) {
    const m = etMinutes(b.time);
    if (m >= RTH_OPEN && m < RTH_CLOSE) continue;
    onHigh = Math.max(onHigh, b.high);
    onLow = Math.min(onLow, b.low);
    onBars += 1;
  }
  const hasOvernight = onBars >= 6; // ≥30 minutes of genuine overnight bars

  const prevClose = prev ? prev.c : null;
  const pivot = prev ? (prev.h + prev.l + prev.c) / 3 : null;
  return {
    price,
    prevHigh: prev ? prev.h : null,
    prevLow: prev ? prev.l : null,
    prevClose,
    pivot,
    vwap,
    onHigh: hasOvernight ? onHigh : null,
    onLow: hasOvernight ? onLow : null,
    asOf: last ? last.time : null,
  };
}

/** PURE. The trailing contiguous session of an intraday series — bars walked
 *  back from the end until a gap over `gapHours`. Lets a closed-day read
 *  (Yahoo's 1d range answers empty on weekends) use the LAST REAL session
 *  from a longer range instead of approximating. */
export function lastSession(bars: Candle[], gapHours = 4): Candle[] {
  if (bars.length === 0) return [];
  const out: Candle[] = [bars[bars.length - 1]];
  for (let i = bars.length - 2; i >= 0; i--) {
    if (out[0].time - bars[i].time > gapHours * 3600) break;
    out.unshift(bars[i]);
  }
  return out;
}

export type BiasVote = { input: string; value: string; vote: -1 | 0 | 1 };
export type BiasRead = { label: "BULLISH" | "NEUTRAL" | "BEARISH" | "UNAVAILABLE"; votes: BiasVote[] };

const fmtLvl = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2));

/** PURE. The calculated condition: price vs prev close, pivot, and VWAP.
 *  Majority of present inputs decides; under 2 inputs ⇒ UNAVAILABLE. */
export function levelsBias(l: SessionLevels): BiasRead {
  if (l.price === null) return { label: "UNAVAILABLE", votes: [] };
  const votes: BiasVote[] = [];
  const cmp = (name: string, ref: number | null): void => {
    if (ref === null || !Number.isFinite(ref) || ref <= 0) return;
    const pctAway = ((l.price! - ref) / ref) * 100;
    const vote = pctAway > 0.1 ? 1 : pctAway < -0.1 ? -1 : 0;
    votes.push({ input: name, value: `${fmtLvl(ref)} (${pctAway >= 0 ? "+" : ""}${pctAway.toFixed(2)}%)`, vote });
  };
  cmp("vs PREV CLOSE", l.prevClose);
  cmp("vs PIVOT", l.pivot);
  cmp("vs VWAP", l.vwap);
  if (votes.length < 2) return { label: "UNAVAILABLE", votes };
  const sum = votes.reduce((a, b) => a + b.vote, 0);
  return { label: sum >= 2 ? "BULLISH" : sum <= -2 ? "BEARISH" : "NEUTRAL", votes };
}

/** PURE (R2 §5). One context sentence GENERATED from the actual numbers —
 *  never hardcoded prose disconnected from the data. */
export function vixContext(vixChgPct: number | null, spyChgPct: number | null, qqqChgPct: number | null): string | null {
  if (vixChgPct === null) return null;
  const eq = [spyChgPct, qqqChgPct].filter((v): v is number => v !== null);
  if (eq.length === 0) return null;
  const eqAvg = eq.reduce((a, b) => a + b, 0) / eq.length;
  const volWord = vixChgPct <= -1 ? "falling" : vixChgPct >= 1 ? "rising" : "flat";
  const eqWord = eqAvg >= 0.2 ? "rise" : eqAvg <= -0.2 ? "fall" : "drift";
  if (volWord === "falling" && eqWord === "rise") return "volatility falling while equities rise — risk appetite holding";
  if (volWord === "rising" && eqWord === "fall") return "volatility rising as equities fall — hedging demand up";
  if (volWord === "rising" && eqWord === "rise") return "volatility rising WITH equities — unstable tape, moves distrusted";
  if (volWord === "falling" && eqWord === "fall") return "volatility falling as equities fall — an orderly decline, not panic";
  return `volatility ${volWord} while equities ${eqWord}`;
}
