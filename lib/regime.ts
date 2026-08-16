// MARKET REGIME (COMMAND CENTER R1) — CALCULATED, deterministic, explainable.
// Computes ONLY from inputs the app actually holds: index trend from the
// pulse spark closes, VIX level + trend, the live book's bias, and NQ=F
// versus numeric levels stated on live NQ ideas. Pure — no fetches, fully
// unit-tested. Never advice; the label is a described market condition.
//
// The "confidence" is not a percentage dressed up as math: it is the literal
// agreement count of the voting inputs ("3 of 4 inputs agree"), which is the
// only honest formula these inputs support (standing law: no fake %).

export type RegimeInputs = {
  /** % change over the spark window per index; null when the quote is absent */
  spyTrendPct: number | null;
  qqqTrendPct: number | null;
  vix: number | null;
  /** VIX change over the spark window, in points */
  vixTrendPts: number | null;
  /** live book sided counts */
  bookLongs: number;
  bookShorts: number;
  /** NQ=F last vs the mean numeric level stated on live NQ ideas, in % */
  nqVsLevelPct: number | null;
};

export type RegimeVote = { input: string; value: string; vote: -1 | 0 | 1 };
export type RegimeLabel = "RISK ON" | "NEUTRAL" | "RISK OFF" | "UNAVAILABLE";
export type RegimeRead = {
  label: RegimeLabel;
  because: RegimeVote[];
  /** the real formula: how many voting inputs agree with the label's sign */
  agreement: { agree: number; voting: number } | null;
};

const sgn = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/** PURE. Fixed VIX buckets (also used by R2's VIX-in-context module). */
export function vixBucket(v: number): "LOW" | "NORMAL" | "ELEVATED" | "HIGH" {
  return v < 15 ? "LOW" : v < 20 ? "NORMAL" : v < 28 ? "ELEVATED" : "HIGH";
}

/** PURE. Extract the first plausible numeric level from a stated free-text
 *  level ("21,450", "break of 21400", "reclaim 21.5k"). null = none. */
export function parseStatedLevel(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const k = /(\d+(?:\.\d+)?)\s*k\b/i.exec(raw);
  if (k) return Number(k[1]) * 1000;
  const m = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,6}(?:\.\d+)?)/.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** PURE. The regime read. Fewer than 2 usable inputs ⇒ UNAVAILABLE (honest). */
export function computeRegime(i: RegimeInputs): RegimeRead {
  const because: RegimeVote[] = [];

  const trends = [i.spyTrendPct, i.qqqTrendPct].filter((v): v is number => v !== null);
  if (trends.length) {
    const avg = trends.reduce((a, b) => a + b, 0) / trends.length;
    const vote = avg > 1 ? 1 : avg < -1 ? -1 : 0;
    const bits = [
      ...(i.spyTrendPct !== null ? [`SPY ${pct(i.spyTrendPct)}`] : []),
      ...(i.qqqTrendPct !== null ? [`QQQ ${pct(i.qqqTrendPct)}`] : []),
    ];
    because.push({ input: "INDEX TREND (1mo)", value: bits.join(" · "), vote });
  }

  if (i.vix !== null) {
    const vote = i.vix < 15 ? 1 : i.vix > 25 ? -1 : 0;
    because.push({ input: "VIX LEVEL", value: `${i.vix.toFixed(1)} · ${vixBucket(i.vix)}`, vote });
  }

  if (i.vixTrendPts !== null) {
    const vote = i.vixTrendPts <= -1 ? 1 : i.vixTrendPts >= 1 ? -1 : 0;
    because.push({
      input: "VIX TREND (1mo)",
      value: `${i.vixTrendPts >= 0 ? "+" : ""}${i.vixTrendPts.toFixed(1)} pts`,
      vote,
    });
  }

  const sided = i.bookLongs + i.bookShorts;
  if (sided > 0) {
    const vote = sgn(i.bookLongs - i.bookShorts);
    because.push({ input: "DESK BOOK BIAS", value: `${i.bookLongs} long · ${i.bookShorts} short`, vote });
  }

  if (i.nqVsLevelPct !== null) {
    const vote = i.nqVsLevelPct > 0.5 ? 1 : i.nqVsLevelPct < -0.5 ? -1 : 0;
    because.push({ input: "NQ vs STATED LEVELS", value: `${pct(i.nqVsLevelPct)} vs book levels`, vote });
  }

  if (because.length < 2) {
    return { label: "UNAVAILABLE", because, agreement: null };
  }

  const sum = because.reduce((a, b) => a + b.vote, 0);
  const label: RegimeLabel = sum >= 2 ? "RISK ON" : sum <= -2 ? "RISK OFF" : "NEUTRAL";
  const voting = because.filter((b) => b.vote !== 0).length;
  const winner = sgn(sum);
  const agree = winner === 0 ? 0 : because.filter((b) => b.vote === winner).length;
  return {
    label,
    because,
    agreement: voting > 0 && winner !== 0 ? { agree, voting } : null,
  };
}

/** PURE. % move across a spark-close series (first → last). null when thin. */
export function sparkTrendPct(closes: number[] | undefined | null): number | null {
  if (!closes || closes.length < 2) return null;
  const first = closes[0];
  const last = closes[closes.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return ((last - first) / first) * 100;
}

/** PURE. Point move across a spark series (for VIX). */
export function sparkTrendPts(closes: number[] | undefined | null): number | null {
  if (!closes || closes.length < 2) return null;
  const first = closes[0];
  const last = closes[closes.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return last - first;
}
