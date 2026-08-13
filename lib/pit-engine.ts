// THE PIT (GAME-3) — the pure round engine. No React, no DOM, no network:
// everything a round IS (tapes, catalysts, positions, ticks, the bell, the
// score) lives here so the smoke test can play a full round programmatically
// and the surface component only draws. SIMULATED ONLY — catalysts are
// archetype headlines with a SIM chip, never factual claims about real
// companies.

export const START_CASH = 10_000;
export const MARGIN_FRAC = 0.4;
export const TPS = 12;

// ── universe (GP2): real tickers, category personalities, SIM tapes ──────────
export type Cat = { vol: number; drift: number; tickers: string[] };
export const CATS: Record<string, Cat> = {
  mega: { vol: 0.004, drift: 0.0004, tickers: ["AAPL", "MSFT", "AMZN", "GOOGL"] },
  tech: { vol: 0.007, drift: 0.0007, tickers: ["NVDA", "META", "PLTR", "CRM"] },
  semi: { vol: 0.009, drift: 0.0006, tickers: ["AMD", "AVGO", "MU", "SMCI"] },
  banks: { vol: 0.004, drift: 0.0002, tickers: ["JPM", "GS", "BAC", "WFC"] },
  energy: { vol: 0.005, drift: 0.0002, tickers: ["XOM", "CVX", "OXY", "SLB"] },
  consumer: { vol: 0.004, drift: 0.0003, tickers: ["WMT", "MCD", "NKE", "SBUX"] },
  health: { vol: 0.005, drift: 0.0003, tickers: ["LLY", "UNH", "PFE", "MRK"] },
  crypto: { vol: 0.013, drift: 0.0008, tickers: ["COIN", "MSTR", "HOOD", "RIOT"] },
  highvol: { vol: 0.016, drift: 0.001, tickers: ["TSLA", "GME", "AFRM", "UPST"] },
};

export type RoundDef = {
  n: number; name: string; mission: string; missionKey: "beat" | "momentum" | "short" | "lowrisk" | "survivor";
  secs: number; stocks: number; cats: string[]; shorts: boolean; positions: number;
  catalysts: number; volMult: number; regime: number; // regime drift bias
};
export const LADDER: RoundDef[] = [
  { n: 1, name: "OPENING BELL", mission: "BEAT THE MARKET — finish above the SPY line", missionKey: "beat", secs: 90, stocks: 4, cats: ["mega", "consumer", "banks", "tech"], shorts: false, positions: 1, catalysts: 0, volMult: 0.8, regime: 0.0003 },
  { n: 2, name: "MOMENTUM", mission: "MOMENTUM HUNTER — take profit on the day's fastest riser", missionKey: "momentum", secs: 80, stocks: 4, cats: ["tech", "semi", "highvol", "mega"], shorts: true, positions: 1, catalysts: 1, volMult: 1.15, regime: 0.0002 },
  { n: 3, name: "EARNINGS", mission: "SHORT SELLER — book a profitable short", missionKey: "short", secs: 75, stocks: 4, cats: ["tech", "semi", "health", "consumer"], shorts: true, positions: 2, catalysts: 2, volMult: 1.1, regime: 0 },
  { n: 4, name: "THE CRASH", mission: "SURVIVOR — never breach 20% drawdown", missionKey: "survivor", secs: 45, stocks: 4, cats: ["banks", "energy", "mega", "highvol"], shorts: true, positions: 2, catalysts: 2, volMult: 1.5, regime: -0.0016 },
  { n: 5, name: "BOSS — TRIPLE WITCHING", mission: "LOW RISK — finish green with max drawdown under 5%", missionKey: "lowrisk", secs: 120, stocks: 5, cats: ["highvol", "crypto", "semi", "tech", "mega"], shorts: true, positions: 2, catalysts: 3, volMult: 1.6, regime: -0.0002 },
];

export const CATALYST_COPY: Array<{ label: string; dir: 1 | -1 }> = [
  { label: "EARNINGS BEAT", dir: 1 },
  { label: "ANALYST DOWNGRADE", dir: -1 },
  { label: "SQUEEZE — ×2 WINDOW", dir: 1 },
  { label: "GUIDANCE CUT", dir: -1 },
  { label: "SECTOR UPGRADE", dir: 1 },
];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Catalyst = { stock: number; at: number; clueAt: number; label: string; dir: 1 | -1; hit: boolean };
export type Stock = { ticker: string; prices: number[] };

export function makeRound(def: RoundDef, runSeed: number): { stocks: Stock[]; spy: number[]; catalysts: Catalyst[] } {
  const rng = mulberry32(runSeed * 7919 + def.n * 104729);
  const N = def.secs * TPS;
  const picks: Array<{ t: string; c: Cat }> = [];
  const used = new Set<string>();
  for (let s = 0; s < def.stocks; s++) {
    const cat = CATS[def.cats[s % def.cats.length]];
    let t = cat.tickers[Math.floor(rng() * cat.tickers.length)];
    while (used.has(t)) t = cat.tickers[Math.floor(rng() * cat.tickers.length)];
    used.add(t);
    picks.push({ t, c: cat });
  }
  const catalysts: Catalyst[] = [];
  for (let k = 0; k < def.catalysts; k++) {
    const copy = CATALYST_COPY[Math.floor(rng() * CATALYST_COPY.length)];
    const at = Math.floor((0.25 + rng() * 0.55) * N);
    catalysts.push({ stock: Math.floor(rng() * def.stocks), at, clueAt: at - 5 * TPS, label: copy.label, dir: copy.dir, hit: false });
  }
  const gen = (c: Cat, idx: number): number[] => {
    let p = 60 + rng() * 240;
    const out: number[] = [];
    for (let i = 0; i < N; i++) {
      let drift = def.regime + (rng() - 0.5) * c.drift * 2;
      const cat = catalysts.find((x) => x.stock === idx && i >= x.at && i < x.at + 4 * TPS);
      if (cat) drift += cat.dir * (0.004 + rng() * 0.004); // the move the clue warned about
      const corr = def.regime < -0.001 ? def.regime * 2 : 0; // crash correlation
      p = Math.max(4, p * (1 + drift + corr + (rng() - 0.5) * c.vol * def.volMult));
      out.push(p);
    }
    return out;
  };
  const stocks = picks.map((pk, i) => ({ ticker: pk.t, prices: gen(pk.c, i) }));
  // the SPY sim line — the benchmark for BEAT THE MARKET
  let sp = 100;
  const spy = Array.from({ length: N }, () => (sp = sp * (1 + def.regime * 0.6 + (rng() - 0.5) * 0.002)));
  return { stocks, spy, catalysts };
}

// ── the live round runtime ───────────────────────────────────────────────────

export type Position = { dir: 1 | -1; entry: number; qty: number };
export type Pop = { text: string; cls: 1 | -1 };
export type TickEnd = "margin" | "bell" | null;

export type RoundSummary = {
  startEq: number; endEq: number; roundPct: number; spyPct: number; missionHit: boolean;
  score: number; parts: Array<[string, number]>; xp: number;
  trades: number; wins: number; goodEntries: number; maxDD: number; margin: boolean;
};

export type RoundRun = {
  def: RoundDef;
  startEq: number;
  stocks: Stock[];
  spy: number[];
  catalysts: Catalyst[];
  positions: Array<Position | null>;
  /** current tick — advanced by tick() */
  i: number;
  /** the upcoming catalyst currently in its warning window (fairness rule) */
  clue: Catalyst | null;
  px(s: number, k?: number): number;
  equity(): number;
  act(s: number, dir: 1 | -1 | 0): void;
  /** advance one tick; "margin" | "bell" when the round ends this tick */
  tick(): TickEnd;
  /** flatten everything and settle the round into a scored summary */
  finish(margin: boolean): RoundSummary;
};

export function createRoundRun(
  def: RoundDef,
  runSeed: number,
  startEq: number,
  onPop: (pop: Pop) => void = () => {},
): RoundRun {
  const { stocks, spy, catalysts } = makeRound(def, runSeed);
  const N = def.secs * TPS;
  let cash = startEq;
  const positions: Array<Position | null> = stocks.map(() => null);
  let peak = startEq;
  let maxDD = 0;
  let trades = 0, wins = 0, goodEntries = 0, shortWin = false, bestRiserWin = false;
  let done = false;

  const px = (s: number, k?: number) =>
    stocks[s].prices[Math.max(0, Math.min(N - 1, k ?? run.i))];
  const equity = () =>
    cash + positions.reduce((sum, p, s) => (p ? sum + p.qty * (p.dir === 1 ? px(s) : 2 * p.entry - px(s)) : sum), 0);
  const openCount = () => positions.filter(Boolean).length;

  const act = (s: number, dir: 1 | -1 | 0): void => {
    if (done) return;
    const i = run.i;
    const p = positions[s];
    const price = px(s);
    if (dir === 0 || (p && p.dir !== dir)) {
      if (!p) return;
      const value = p.qty * (p.dir === 1 ? price : 2 * p.entry - price);
      const gain = (p.dir === 1 ? price / p.entry - 1 : 1 - price / p.entry) * 100;
      cash += value;
      positions[s] = null;
      trades += 1;
      if (gain > 0) {
        wins += 1;
        if (p.dir === -1) shortWin = true;
        const perf = stocks.map((st) => st.prices[Math.min(i, N - 1)] / st.prices[0]);
        if (s === perf.indexOf(Math.max(...perf))) bestRiserWin = true;
      }
      onPop({ text: `${gain >= 0 ? "+" : ""}${gain.toFixed(1)}% ${stocks[s].ticker}`, cls: gain >= 0 ? 1 : -1 });
      if (dir !== 0) act(s, dir); // flip: flatten then open the other way
      return;
    }
    if (p || openCount() >= def.positions || (dir === -1 && !def.shorts)) return;
    const stake = cash / (def.positions - openCount());
    positions[s] = { dir, entry: price, qty: stake / price };
    cash -= stake;
    // timing quality: entry near the rolling low (long) / high (short)
    let lo = Infinity, hi = -Infinity;
    for (let j = Math.max(0, i - 48); j <= i; j++) { lo = Math.min(lo, px(s, j)); hi = Math.max(hi, px(s, j)); }
    const good = dir === 1 ? price <= lo * 1.02 : price >= hi * 0.98;
    if (good) { goodEntries += 1; onPop({ text: "GOOD ENTRY", cls: 1 }); }
    const cat = catalysts.find((c) => c.stock === s && i >= c.at && i < c.at + 6 * TPS);
    if (cat && ((cat.dir === 1 && dir === 1) || (cat.dir === -1 && dir === -1))) {
      cat.hit = true;
      onPop({ text: "CATALYST CAPTURED", cls: 1 });
    }
  };

  const tick = (): TickEnd => {
    if (done || run.i >= N - 1) return done ? null : "bell";
    run.i += 1;
    run.clue = catalysts.find((c) => run.i >= c.clueAt && run.i < c.at) ?? null;
    const eq = equity();
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, (1 - eq / peak) * 100);
    if (eq < startEq * MARGIN_FRAC) return "margin";
    if (run.i >= N - 1) return "bell";
    return null;
  };

  const finish = (margin: boolean): RoundSummary => {
    positions.forEach((p, s) => p && act(s, 0));
    done = true;
    const endEq = equity();
    const roundPct = (endEq / startEq - 1) * 100;
    const spyPct = (spy[Math.min(run.i, N - 1)] / spy[0] - 1) * 100;
    const missionHit = margin ? false :
      def.missionKey === "beat" ? roundPct > spyPct :
      def.missionKey === "momentum" ? bestRiserWin :
      def.missionKey === "short" ? shortWin :
      def.missionKey === "lowrisk" ? roundPct >= 0 && maxDD < 5 :
      maxDD < 20;
    const parts: Array<[string, number]> = [
      ["P&L", Math.round(roundPct * 120)],
      ["MISSION", missionHit ? 2000 : 0],
      ["TIMING", goodEntries * 350],
      ["ACCURACY", trades ? Math.round((wins / trades) * 1200) : 0],
      ["DRAWDOWN", -Math.round(maxDD * 60)],
    ];
    const score = Math.max(0, parts.reduce((a, [, v]) => a + v, 0));
    const xp = Math.max(50, Math.round(score / 10) + (missionHit ? 120 : 0));
    return { startEq, endEq, roundPct, spyPct, missionHit, score, parts, xp, trades, wins, goodEntries, maxDD, margin };
  };

  const run: RoundRun = { def, startEq, stocks, spy, catalysts, positions, i: 0, clue: null, px, equity, act, tick, finish };
  return run;
}
