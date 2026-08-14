// THE PIT (GAME-3) — the pure round engine, TAPE v2. No React, no DOM, no
// network: everything a day IS (tapes, catalysts, positions, ticks, the bell,
// the score) lives here so the smoke + fairness suites can play whole days
// programmatically and the surface component only draws.
//
// TAPE v2 (tuning round T1): waypoint-planned regime paths instead of a
// monotonic random walk. Every stock's day is laid out as macro waypoints
// that GUARANTEE at least one meaningful drawdown and one meaningful rally,
// then textured with impulse→partial-retrace bumps (30–60%, or 130–170% for
// fakeouts) and filled with bridge-corrected noise under a same-direction
// streak cap. Net day moves are pinned inside per-day bands (no guaranteed
// hold-to-win), and CRASH DAY is a slide punctuated by a violent trap rally.
// Bell settlement liquidates without counting as trading (T5): missions are
// earned by deliberate closes only. SIMULATED ONLY.

export const START_CASH = 10_000;
export const MARGIN_FRAC = 0.4;

// ── owner tuning (T3): multipliers around the shipped day configs ────────────
export type PitTune = {
  /** tick-rate multiplier — applied by the CLOCK (component), not the tape */
  tps: number;
  /** noise + texture amplitude */
  vol: number;
  /** net-move band stretch */
  drift: number;
  /** impulse/retrace texture frequency */
  retrace: number;
  /** catalyst magnitude */
  events: number;
};
export const DEFAULT_TUNE: PitTune = { tps: 1, vol: 1, drift: 1, retrace: 1, events: 1 };

// ── universe (GP2): real tickers, category personalities, SIM tapes ──────────
export type Cat = { vol: number; tickers: string[] };
export const CATS: Record<string, Cat> = {
  mega: { vol: 0.85, tickers: ["AAPL", "MSFT", "AMZN", "GOOGL"] },
  tech: { vol: 1.1, tickers: ["NVDA", "META", "PLTR", "CRM"] },
  semi: { vol: 1.25, tickers: ["AMD", "AVGO", "MU", "SMCI"] },
  banks: { vol: 0.8, tickers: ["JPM", "GS", "BAC", "WFC"] },
  energy: { vol: 0.9, tickers: ["XOM", "CVX", "OXY", "SLB"] },
  consumer: { vol: 0.8, tickers: ["WMT", "MCD", "NKE", "SBUX"] },
  health: { vol: 0.9, tickers: ["LLY", "UNH", "PFE", "MRK"] },
  crypto: { vol: 1.5, tickers: ["COIN", "MSTR", "HOOD", "RIOT"] },
  highvol: { vol: 1.65, tickers: ["TSLA", "GME", "AFRM", "UPST"] },
};

// ── the calendar (T4): rounds are DAYS, five days clear the WEEK ─────────────
export type RoundDef = {
  n: number; name: string; mission: string; missionKey: "beat" | "momentum" | "short" | "lowrisk" | "survivor";
  /** MARKET WEATHER — the brief's telegraph line; must match the regime below */
  weather: string;
  secs: number;
  /** ticks per second — per-day pacing (T2); calm open → fast boss */
  tps: number;
  stocks: number; cats: string[]; shorts: boolean; positions: number; catalysts: number;
  /** per-tick log-noise amplitude before category/tune multipliers */
  vol: number;
  /** net day move band, % of open (drift caps — no guaranteed hold-to-win) */
  netMin: number; netMax: number;
  /** guaranteed swings, % (waypoint-enforced) */
  minDD: number; minRally: number;
  /** SPY's net day band, % */
  spyNet: [number, number];
  /** day-1 rule: every stock closes at least this many pp BELOW SPY */
  capBelowSpy?: number;
  /** CRASH DAY macro: slide → violent trap rally → final leg */
  crash?: boolean;
};

export const LADDER: RoundDef[] = [
  {
    n: 1, name: "OPENING BELL", mission: "BEAT THE MARKET — finish above the SPY line", missionKey: "beat",
    weather: "QUIET OPEN — a drift with a bid under it. Nothing outruns the index by standing still.",
    secs: 90, tps: 6, stocks: 4, cats: ["mega", "consumer", "banks", "tech"], shorts: false, positions: 1,
    catalysts: 0, vol: 0.0035, netMin: -3.5, netMax: 99, minDD: 4, minRally: 4, spyNet: [0.8, 1.6], capBelowSpy: 0.8,
  },
  {
    n: 2, name: "MOMENTUM", mission: "MOMENTUM HUNTER — take profit on the day's fastest riser", missionKey: "momentum",
    weather: "MOMENTUM TAPE — runners run, then get faded. Sell into strength or ride it back down.",
    secs: 80, tps: 7, stocks: 4, cats: ["tech", "semi", "highvol", "mega"], shorts: true, positions: 1,
    catalysts: 1, vol: 0.005, netMin: -6, netMax: 7, minDD: 5, minRally: 7, spyNet: [-0.5, 1.5],
  },
  {
    n: 3, name: "EARNINGS", mission: "SHORT SELLER — book a profitable short", missionKey: "short",
    weather: "EARNINGS WEEK — headlines hit mid-session. The clue prints before the move.",
    secs: 75, tps: 8, stocks: 4, cats: ["tech", "semi", "health", "consumer"], shorts: true, positions: 2,
    catalysts: 2, vol: 0.0055, netMin: -6, netMax: 5, minDD: 6, minRally: 6, spyNet: [-1, 1],
  },
  {
    n: 4, name: "THE CRASH", mission: "SURVIVOR — never breach 20% drawdown", missionKey: "survivor",
    weather: "FED DAY — everything's twitchy. The bounces are traps; so is the hole.",
    secs: 45, tps: 10, stocks: 4, cats: ["banks", "energy", "mega", "highvol"], shorts: true, positions: 2,
    catalysts: 2, vol: 0.007, netMin: -26, netMax: -14, minDD: 30, minRally: 25, spyNet: [-12, -7], crash: true,
  },
  {
    n: 5, name: "FRIDAY — OPEX", mission: "LOW RISK — finish green with max drawdown under 5%", missionKey: "lowrisk",
    weather: "FRIDAY — OPEX. Pinned for stretches, then violent. Small book, quick hands.",
    secs: 120, tps: 9, stocks: 5, cats: ["highvol", "crypto", "semi", "tech", "mega"], shorts: true, positions: 2,
    catalysts: 3, vol: 0.006, netMin: -8, netMax: 8, minDD: 7, minRally: 8, spyNet: [-2, 2],
  },
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

// ── tape v2 internals ────────────────────────────────────────────────────────

const MAX_STREAK = 6; // consecutive same-direction ticks before a forced flip

type Wp = { t: number; v: number }; // tick, log price relative to open

/** value of the waypoint polyline at tick t */
function wpAt(wps: Wp[], t: number): number {
  for (let k = 1; k < wps.length; k++) {
    if (t <= wps[k].t) {
      const a = wps[k - 1], b = wps[k];
      return b.t === a.t ? b.v : a.v + ((t - a.t) / (b.t - a.t)) * (b.v - a.v);
    }
  }
  return wps[wps.length - 1].v;
}

function insertWp(wps: Wp[], wp: Wp): void {
  const t = Math.max(1, Math.min(wp.t, wps[wps.length - 1].t - 1));
  const ix = wps.findIndex((w) => w.t >= t);
  if (ix <= 0) return;
  if (wps[ix].t === t) { wps[ix] = { t, v: wp.v }; return; }
  wps.splice(ix, 0, { t, v: wp.v });
}

/** noisy increments between waypoints, bridge-corrected to hit each waypoint
 *  exactly, under the same-direction streak cap. */
function fillPath(wps: Wp[], N: number, vol: number, rng: () => number): number[] {
  const out = new Array<number>(N);
  out[0] = wps[0].v;
  for (let k = 1; k < wps.length; k++) {
    const a = wps[k - 1], b = wps[k];
    const len = b.t - a.t;
    if (len <= 0) continue;
    const eps: number[] = [];
    let streak = 0, prevSign = 0, sum = 0;
    for (let j = 0; j < len; j++) {
      let e = (rng() * 2 - 1) * vol;
      const s = e >= 0 ? 1 : -1;
      if (s === prevSign) {
        streak += 1;
        if (streak >= MAX_STREAK) { e = -s * Math.max(Math.abs(e), vol * 0.4); streak = 0; prevSign = -s; }
        else prevSign = s;
      } else { streak = 1; prevSign = s; }
      eps.push(e); sum += e;
    }
    const corr = (b.v - a.v - sum) / len;
    let v = a.v;
    for (let j = 0; j < len; j++) { v += eps[j] + corr; out[a.t + j + 1] = v; }
    out[b.t] = b.v; // pin the waypoint exactly
  }
  return out;
}

/** final pass: break any same-direction run over the cap by pulling one tick
 *  against the move (a micro-retrace inside the impulse). Only path[k] moves,
 *  so every later level — waypoints included — is preserved exactly. */
function capStreaks(path: number[], cap: number): void {
  let streak = 0, prev = 0;
  for (let k = 1; k < path.length - 1; k++) {
    const d = path[k] - path[k - 1];
    const s = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (s === 0) continue;
    if (s === prev) streak += 1; else { streak = 1; prev = s; }
    if (streak > cap) {
      path[k] -= s * Math.abs(d) * 1.4; // this tick now reads against the run
      streak = 1; prev = -s;
    }
  }
}

/** impulse → partial-retrace texture (fakeouts retrace past the origin) */
function addTexture(wps: Wp[], N: number, tps: number, vol: number, tune: PitTune, rng: () => number): void {
  const spacing = Math.max(4 * tps, Math.floor(N / 10));
  for (let t = spacing; t < N - spacing; t += spacing) {
    if (rng() > 0.65 * tune.retrace) continue;
    const t0 = t + Math.floor((rng() - 0.5) * spacing * 0.6);
    const dur = Math.max(Math.floor(0.8 * tps), Math.floor((0.8 + rng() * 0.7) * tps));
    if (t0 + dur * 2 >= N - 2) continue;
    const dir = rng() < 0.5 ? 1 : -1;
    const mag = (0.9 + rng() * 1.6) * vol * tps * 1.8 * tune.vol; // a multi-tick move, humanly visible
    const base = wpAt(wps, t0 + dur);
    const fake = rng() < 0.3; // first-class fakeout: the break that reverses
    const retrace = fake ? 1.3 + rng() * 0.4 : 0.3 + rng() * 0.3;
    insertWp(wps, { t: t0 + dur, v: base + dir * mag });
    insertWp(wps, { t: t0 + dur + Math.max(2, Math.floor(dur * (0.8 + rng() * 0.6))), v: base + dir * mag * (1 - retrace) });
  }
}

function stockWaypoints(def: RoundDef, N: number, tune: PitTune, spyNet: number, rng: () => number): Wp[] {
  const L = (pct: number) => Math.log(1 + pct / 100);
  if (def.crash) {
    // CRASH DAY: slide → violent trap rally (the skill test) → the real leg down
    const fall = 30 + rng() * 8; // %
    const t1 = Math.floor((0.3 + rng() * 0.12) * N);
    const trapTop = -1 + rng() * 5; // rips back to −1..+4% — shorts get hurt, longs get baited
    const t2 = t1 + Math.floor((0.16 + rng() * 0.1) * N);
    const net = -(14 + rng() * 12) * tune.drift;
    const wps: Wp[] = [{ t: 0, v: 0 }, { t: t1, v: L(-fall) }, { t: t2, v: L(trapTop) }, { t: N - 1, v: L(net) }];
    // one bear-market bounce inside the first slide — the early trap
    const tb = Math.floor(t1 * 0.55);
    insertWp(wps, { t: tb, v: L(-fall * 0.55) });
    insertWp(wps, { t: Math.floor(t1 * 0.72), v: L(-fall * 0.55) + L(fall * 0.22) });
    return wps;
  }
  const dd = (def.minDD + rng() * def.minDD * 0.5) * tune.vol;
  const rally = (def.minRally + rng() * def.minRally * 0.5) * tune.vol;
  const capMax = def.capBelowSpy !== undefined ? spyNet - def.capBelowSpy : def.netMax;
  const lo = Math.min(def.netMin * tune.drift, capMax - 0.1);
  const net = lo + rng() * (capMax - lo);
  const t1 = Math.floor((0.18 + rng() * 0.25) * N);
  const t2 = Math.min(N - Math.floor(N * 0.12), t1 + Math.max(Math.floor(N * 0.15), 6 * def.tps));
  const wps: Wp[] = [{ t: 0, v: 0 }];
  if (rng() < 0.5) {
    // down first: open → trough (the drawdown) → rally off the low → close
    wps.push({ t: t1, v: L(-dd) });
    wps.push({ t: t2, v: L(-dd) + L(rally) });
  } else {
    // up first: open → peak (the rally) → give it back (the drawdown) → close
    wps.push({ t: t1, v: L(rally) });
    wps.push({ t: t2, v: L(rally) + L(-dd) });
  }
  wps.push({ t: N - 1, v: L(net) });
  return wps;
}

export function makeRound(
  def: RoundDef,
  runSeed: number,
  tune: PitTune = DEFAULT_TUNE,
): { stocks: Stock[]; spy: number[]; catalysts: Catalyst[]; spyNet: number } {
  const rng = mulberry32(runSeed * 7919 + def.n * 104729);
  const N = def.secs * def.tps;
  const L = (pct: number) => Math.log(1 + pct / 100);

  // the index first — day-1 stock caps are relative to it
  const spyNet = def.spyNet[0] + rng() * (def.spyNet[1] - def.spyNet[0]);
  const spyWps: Wp[] = [{ t: 0, v: 0 }];
  if (def.crash) {
    spyWps.push({ t: Math.floor(N * 0.45), v: L(spyNet * 1.6) });
    spyWps.push({ t: Math.floor(N * 0.62), v: L(spyNet * 0.8) });
  }
  spyWps.push({ t: N - 1, v: L(spyNet) });
  const spyPath = fillPath(spyWps, N, 0.0006, rng);
  const spy = spyPath.map((v) => 100 * Math.exp(v));

  // picks
  const picks: Array<{ t: string; c: Cat }> = [];
  const used = new Set<string>();
  for (let s = 0; s < def.stocks; s++) {
    const cat = CATS[def.cats[s % def.cats.length]];
    let t = cat.tickers[Math.floor(rng() * cat.tickers.length)];
    while (used.has(t)) t = cat.tickers[Math.floor(rng() * cat.tickers.length)];
    used.add(t);
    picks.push({ t, c: cat });
  }

  // catalysts — clue prints ~5s before the move (fairness rule)
  const catalysts: Catalyst[] = [];
  for (let k = 0; k < def.catalysts; k++) {
    const copy = CATALYST_COPY[Math.floor(rng() * CATALYST_COPY.length)];
    const at = Math.floor((0.25 + rng() * 0.5) * N);
    catalysts.push({ stock: Math.floor(rng() * def.stocks), at, clueAt: at - 5 * def.tps, label: copy.label, dir: copy.dir, hit: false });
  }

  const stocks: Stock[] = picks.map((pk, idx) => {
    const vol = def.vol * pk.c.vol * tune.vol;
    const wps = stockWaypoints(def, N, tune, spyNet, rng);
    addTexture(wps, N, def.tps, vol, tune, rng);
    // catalyst = impulse waypoint + 30–60% retrace, on top of the macro path
    for (const c of catalysts) {
      if (c.stock !== idx) continue;
      const mag = L((2.5 + rng() * 1.5) * tune.events) * c.dir;
      const base = wpAt(wps, c.at);
      insertWp(wps, { t: c.at, v: base });
      insertWp(wps, { t: c.at + Math.floor(1.2 * def.tps), v: base + mag });
      insertWp(wps, { t: c.at + Math.floor(3.5 * def.tps), v: base + mag * (0.45 + rng() * 0.15) });
    }
    const path = fillPath(wps, N, vol, rng);
    capStreaks(path, MAX_STREAK);
    const open = 40 + rng() * 260;
    return { ticker: pk.t, prices: path.map((v) => open * Math.exp(v)) };
  });

  return { stocks, spy, catalysts, spyNet };
}

// ── the live round runtime ───────────────────────────────────────────────────

export type Position = { dir: 1 | -1; entry: number; qty: number; worstPct: number };
export type TradeMark = { s: number; tick: number; price: number; dir: 1 | -1; kind: "open" | "close"; gain?: number };
export type PitEvent =
  | { type: "pop"; text: string; cls: 1 | -1 }
  | { type: "goodEntry"; stock: number }
  | { type: "catalyst"; stock: number }
  | { type: "panicSell"; stock: number }
  | { type: "stopOut"; stock: number }
  | { type: "diamondHands"; stock: number }
  | { type: "paperHands"; stock: number };
export type TickEnd = "margin" | "bell" | null;

export type RoundSummary = {
  startEq: number; endEq: number; roundPct: number; spyPct: number; missionHit: boolean;
  score: number; parts: Array<[string, number]>; xp: number;
  trades: number; wins: number; goodEntries: number; maxDD: number; margin: boolean;
};

type CarryState = {
  cash: number; positions: Array<Position | null>; peak: number; maxDD: number;
  trades: number; wins: number; goodEntries: number; shortWin: boolean; bestRiserWin: boolean;
  log: TradeMark[]; stamps: Set<string>;
};

export type RoundRun = {
  def: RoundDef;
  startEq: number;
  seed: number;
  tune: PitTune;
  stocks: Stock[];
  spy: number[];
  catalysts: Catalyst[];
  positions: Array<Position | null>;
  /** the deliberate-trade log — DAY REPLAY marks come from here */
  log: TradeMark[];
  /** current tick — advanced by tick() */
  i: number;
  /** total ticks in this tape */
  N: number;
  /** the upcoming catalyst currently in its warning window */
  clue: Catalyst | null;
  px(s: number, k?: number): number;
  equity(): number;
  act(s: number, dir: 1 | -1 | 0): void;
  /** advance one tick; "margin" | "bell" when the day ends this tick */
  tick(): TickEnd;
  /** settle the day into a scored summary — bell liquidation is NOT trading:
   *  it counts no trades/wins and sets no mission flags (T5). */
  finish(margin: boolean): RoundSummary;
  /** internal carve-out for retuneRun */
  _carry(): CarryState;
};

export function createRoundRun(
  def: RoundDef,
  runSeed: number,
  startEq: number,
  onEvent: (ev: PitEvent) => void = () => {},
  carry?: CarryState & { opens: number[]; secsLeft: number; catalystsLeft: number },
): RoundRun {
  const tune = DEFAULT_TUNE;
  return createRoundRunTuned(def, runSeed, startEq, tune, onEvent, carry);
}

export function createRoundRunTuned(
  def: RoundDef,
  runSeed: number,
  startEq: number,
  tune: PitTune,
  onEvent: (ev: PitEvent) => void = () => {},
  carry?: CarryState & { opens: number[]; secsLeft: number; catalystsLeft: number },
): RoundRun {
  let genDef = def;
  if (carry) {
    // retune continuation: a fresh tape for the remaining clock, starting at
    // the current prices, swing constraints scaled to what's left of the day
    const frac = Math.max(0.25, carry.secsLeft / def.secs);
    genDef = {
      ...def,
      secs: Math.max(5, carry.secsLeft),
      catalysts: carry.catalystsLeft,
      minDD: def.minDD * frac, minRally: def.minRally * frac,
      netMin: def.netMin * frac, netMax: def.netMax === 99 ? 99 : def.netMax * frac,
      spyNet: [def.spyNet[0] * frac, def.spyNet[1] * frac],
    };
  }
  const made = makeRound(genDef, runSeed, tune);
  const stocks = made.stocks;
  if (carry) {
    // rebase each fresh tape so it opens at the price the old tape left off
    for (let s = 0; s < stocks.length; s++) {
      const open = carry.opens[s];
      if (open === undefined) continue;
      const p0 = stocks[s].prices[0];
      stocks[s].prices = stocks[s].prices.map((p) => open * (p / p0));
    }
  }
  const { spy, catalysts } = made;
  const N = genDef.secs * genDef.tps;

  let cash = carry ? carry.cash : startEq;
  const positions: Array<Position | null> = carry ? carry.positions : stocks.map(() => null);
  while (positions.length < stocks.length) positions.push(null);
  let peak = carry ? carry.peak : startEq;
  let maxDD = carry ? carry.maxDD : 0;
  let trades = carry ? carry.trades : 0;
  let wins = carry ? carry.wins : 0;
  let goodEntries = carry ? carry.goodEntries : 0;
  let shortWin = carry ? carry.shortWin : false;
  let bestRiserWin = carry ? carry.bestRiserWin : false;
  const log: TradeMark[] = carry ? carry.log : [];
  const stamps = carry ? carry.stamps : new Set<string>();
  let done = false;
  let settling = false;
  const watches: Array<{ s: number; price: number; dir: 1 | -1; until: number }> = [];

  const px = (s: number, k?: number) =>
    stocks[s].prices[Math.max(0, Math.min(N - 1, k ?? run.i))];
  const equity = () =>
    cash + positions.reduce((sum, p, s) => (p ? sum + p.qty * (p.dir === 1 ? px(s) : 2 * p.entry - px(s)) : sum), 0);
  const openCount = () => positions.filter(Boolean).length;

  const act = (s: number, dir: 1 | -1 | 0): void => {
    if (done && !settling) return;
    const i = run.i;
    const p = positions[s];
    const price = px(s);
    if (dir === 0 || (p && p.dir !== dir)) {
      if (!p) return;
      const value = p.qty * (p.dir === 1 ? price : 2 * p.entry - price);
      const gain = (p.dir === 1 ? price / p.entry - 1 : 1 - price / p.entry) * 100;
      cash += value;
      positions[s] = null;
      if (!settling) {
        // deliberate close — the only kind that counts (T5)
        trades += 1;
        if (gain > 0) {
          wins += 1;
          if (p.dir === -1) shortWin = true;
          const perf = stocks.map((st) => st.prices[Math.min(i, N - 1)] / st.prices[0]);
          if (s === perf.indexOf(Math.max(...perf))) bestRiserWin = true;
        }
        log.push({ s, tick: i, price, dir: p.dir, kind: "close", gain });
        onEvent({ type: "pop", text: `${gain >= 0 ? "+" : ""}${gain.toFixed(1)}% ${stocks[s].ticker}`, cls: gain >= 0 ? 1 : -1 });
        // quirk detection (T6)
        if (gain > 0 && p.worstPct <= -8 && !stamps.has("diamond")) {
          stamps.add("diamond");
          onEvent({ type: "diamondHands", stock: s });
        } else if (gain <= -8) {
          onEvent({ type: "stopOut", stock: s });
        } else if (gain < 0) {
          // sold into the hole? near the rolling dir-aware extreme = panic
          let lo = Infinity, hi = -Infinity;
          for (let j = Math.max(0, i - 3 * genDef.tps); j <= i; j++) { lo = Math.min(lo, px(s, j)); hi = Math.max(hi, px(s, j)); }
          const atExtreme = p.dir === 1 ? price <= lo * 1.005 : price >= hi * 0.995;
          if (atExtreme) onEvent({ type: "panicSell", stock: s });
        }
        watches.push({ s, price, dir: p.dir, until: i + 6 * genDef.tps });
        if (dir !== 0) act(s, dir); // flip: flatten then open the other way
      }
      return;
    }
    if (settling) return;
    if (p || openCount() >= def.positions || (dir === -1 && !def.shorts)) return;
    const stake = cash / (def.positions - openCount());
    positions[s] = { dir, entry: price, qty: stake / price, worstPct: 0 };
    cash -= stake;
    log.push({ s, tick: i, price, dir, kind: "open" });
    // timing quality: entry near the rolling low (long) / high (short)
    let lo = Infinity, hi = -Infinity;
    const back = 4 * genDef.tps;
    for (let j = Math.max(0, i - back); j <= i; j++) { lo = Math.min(lo, px(s, j)); hi = Math.max(hi, px(s, j)); }
    const good = dir === 1 ? price <= lo * 1.02 : price >= hi * 0.98;
    if (good) { goodEntries += 1; onEvent({ type: "goodEntry", stock: s }); onEvent({ type: "pop", text: "GOOD ENTRY", cls: 1 }); }
    const cat = catalysts.find((c) => c.stock === s && i >= c.at && i < c.at + 6 * genDef.tps);
    if (cat && ((cat.dir === 1 && dir === 1) || (cat.dir === -1 && dir === -1))) {
      cat.hit = true;
      onEvent({ type: "catalyst", stock: s });
      onEvent({ type: "pop", text: "CATALYST CAPTURED", cls: 1 });
    }
  };

  const tick = (): TickEnd => {
    if (done || run.i >= N - 1) return done ? null : "bell";
    run.i += 1;
    const i = run.i;
    run.clue = catalysts.find((c) => i >= c.clueAt && i < c.at) ?? null;
    // adverse-excursion tracking (DIAMOND HANDS) + missed-move watches (PAPER)
    for (let s = 0; s < positions.length; s++) {
      const p = positions[s];
      if (!p) continue;
      const adverse = (p.dir === 1 ? px(s) / p.entry - 1 : 1 - px(s) / p.entry) * 100;
      if (adverse < p.worstPct) p.worstPct = adverse;
    }
    for (let w = watches.length - 1; w >= 0; w--) {
      const wt = watches[w];
      if (i > wt.until) { watches.splice(w, 1); continue; }
      const missed = wt.dir === 1 ? px(wt.s) >= wt.price * 1.05 : px(wt.s) <= wt.price * 0.95;
      if (missed) {
        watches.splice(w, 1);
        if (!stamps.has("paper")) { stamps.add("paper"); onEvent({ type: "paperHands", stock: wt.s }); }
      }
    }
    const eq = equity();
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, (1 - eq / peak) * 100);
    if (eq < startEq * MARGIN_FRAC) return "margin";
    if (run.i >= N - 1) return "bell";
    return null;
  };

  const finish = (margin: boolean): RoundSummary => {
    settling = true;
    positions.forEach((p, s) => p && act(s, 0)); // liquidation, not trading
    settling = false;
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

  const run: RoundRun = {
    def, startEq, seed: runSeed, tune, stocks, spy, catalysts, positions, log,
    i: 0, N, clue: null, px, equity, act, tick, finish,
    _carry: () => ({ cash, positions, peak, maxDD, trades, wins, goodEntries, shortWin, bestRiserWin, log, stamps }),
  };
  return run;
}

/** T3 — apply new tuning to a RUNNING day: fresh tape for the remaining clock
 *  starting at the current prices; cash/positions/stats carry over seamlessly.
 *  (The tick-rate slider is applied by the component's clock, not here.) */
export function retuneRun(
  old: RoundRun,
  tune: PitTune,
  onEvent: (ev: PitEvent) => void = () => {},
): RoundRun {
  const secsLeft = Math.max(5, Math.round((old.N - old.i) / old.def.tps));
  const catalystsLeft = old.catalysts.filter((c) => c.at > old.i).length;
  const opens = old.stocks.map((_, s) => old.px(s));
  return createRoundRunTuned(old.def, old.seed + old.i + 1, old.startEq, tune, onEvent, {
    ...old._carry(), opens, secsLeft, catalystsLeft,
  });
}
