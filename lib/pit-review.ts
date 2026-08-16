// PIT POST-TRADE REVIEW (COMMAND CENTER R3) — dry floor-voice explanations
// built STRICTLY from observable round data: the tape, the trade log, and
// the event schedule. Generated at day end (the full tape is known), pure
// and deterministic — educational, specific, never mystical.

import type { GameEvent, RoundDef, Stock, TradeMark } from "./pit-engine";

export type TradeReview = {
  s: number;
  ticker: string;
  dir: 1 | -1;
  gain: number;
  text: string;
};

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/** PURE. One dry line per deliberate close, from the full day's tape. */
export function explainTrades(
  stocks: Stock[],
  events: GameEvent[],
  log: TradeMark[],
  def: Pick<RoundDef, "tps">,
): TradeReview[] {
  const out: TradeReview[] = [];
  const opens = new Map<number, TradeMark>(); // stock → latest unmatched open
  for (const m of log) {
    if (m.kind === "open") {
      opens.set(m.s, m);
      continue;
    }
    const open = opens.get(m.s);
    opens.delete(m.s);
    if (!open) continue;
    const prices = stocks[m.s]?.prices ?? [];
    if (!prices.length) continue;
    const N = prices.length;
    // clauses in priority order: the event linkage teaches the most, then
    // what was endured, then entry quality, then dry hindsight
    let evClause: string | null = null;
    let adverseClause: string | null = null;
    let entryClause: string | null = null;
    let hindsightClause: string | null = null;

    // event interaction on this stock
    const held = (t: number) => t >= open.tick && t <= m.tick;
    for (const ev of events) {
      if (!ev.stocks.includes(m.s)) continue;
      if (held(ev.at)) {
        evClause = `held through the ${ev.label} print${ev.misleading ? " (the headline lied)" : ""}`;
        break;
      }
      const gap = ev.at - m.tick;
      if (gap > 0 && gap <= 10 * def.tps) {
        evClause = `exited ${Math.ceil(gap / def.tps)}s before the ${ev.label} window`;
        break;
      }
    }

    // adverse excursion across the hold
    let worst = 0;
    for (let t = open.tick; t <= Math.min(m.tick, N - 1); t++) {
      const adverse = (m.dir === 1 ? prices[t] / open.price - 1 : 1 - prices[t] / open.price) * 100;
      if (adverse < worst) worst = adverse;
    }
    if (worst <= -5) adverseClause = `sat through ${pct(worst)} against the position`;

    // entry quality vs the session range SO FAR — only once a real range
    // exists (a 3-tick open always puts the entry "at the extreme")
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t <= Math.min(open.tick, N - 1); t++) {
      lo = Math.min(lo, prices[t]);
      hi = Math.max(hi, prices[t]);
    }
    if (hi > lo && (hi - lo) / lo >= 0.01) {
      const posInRange = (open.price - lo) / (hi - lo); // 0 = at the low
      if (m.dir === 1 && posInRange <= 0.15) entryClause = "entered near the session low";
      else if (m.dir === 1 && posInRange >= 0.85) entryClause = "bought near the session high";
      else if (m.dir === -1 && posInRange >= 0.85) entryClause = "shorted near the session high";
      else if (m.dir === -1 && posInRange <= 0.15) entryClause = "shorted into the session low";
    }

    // what the tape did just after the exit (full-tape hindsight, stated dryly)
    const after = Math.min(m.tick + 10 * def.tps, N - 1);
    if (after > m.tick) {
      const later = (m.dir === 1 ? prices[after] / m.price - 1 : 1 - prices[after] / m.price) * 100;
      if (later >= 1.5) hindsightClause = `the tape ran another ${pct(later)} within 10s of the exit`;
      else if (later <= -1.5) hindsightClause = `the exit dodged ${pct(later)} over the next 10s`;
    }

    const clauses = [evClause, adverseClause, entryClause, hindsightClause].filter(
      (c): c is string => c !== null,
    );

    const head = `${m.dir === 1 ? "LONG" : "SHORT"} ${stocks[m.s].ticker} ${pct(m.gain ?? 0)}`;
    out.push({
      s: m.s,
      ticker: stocks[m.s].ticker,
      dir: m.dir,
      gain: m.gain ?? 0,
      text: clauses.length ? `${head} — ${clauses.slice(0, 2).join("; ")}.` : `${head}.`,
    });
  }
  return out;
}
