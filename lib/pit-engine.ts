// THE PIT — the pure game engine (GAME-4: event-driven trading). No React,
// no DOM, no network: everything a day IS — tapes, events, positions, orders,
// P&L, risk, missions, score, XP — lives here as data-driven systems so the
// smoke + fairness suites can play whole days programmatically and the
// surface component only draws.
//
// TAPE v2 (GAME-3 tuning): waypoint-planned regime paths — guaranteed
// drawdown AND rally per stock, impulse→30–60% retraces (fakeouts 130–170%),
// bridge-corrected noise under a streak cap, per-day net bands, CRASH DAY
// trap rallies. Deterministic per seed. GAME-4 events PERTURB that tape
// (impulses baked at generation); they never replace it.
//
// EVENTS (GAME-4): news / opportunity · stock / sector / market scope ·
// clued or breaking · headline direction vs ACTUAL direction — roughly a
// quarter of news is misleading (news ≠ guaranteed direction; that's the
// lesson). Copy is archetype headlines with a SIM chip — never fabricated
// factual claims about real companies.
//
// T5 LAW: bell settlement liquidates without counting as trading — missions
// are earned by deliberate closes only. SIMULATED ONLY.

export const START_CASH = 10_000;
export const MARGIN_FRAC = 0.4;

// ── owner tuning (T3 carry): multipliers around the shipped day configs ──────
export type PitTune = {
  tps: number; vol: number; drift: number; retrace: number; events: number;
};
export const DEFAULT_TUNE: PitTune = { tps: 1, vol: 1, drift: 1, retrace: 1, events: 1 };

// ── universe: real tickers, category personalities, SIM tapes ────────────────
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
  // TRAIN-1 — the training floor's universe: index-flavored SIM names only.
  // Real tickers never appear in lesson tapes (standing rule).
  trainCalm: { vol: 0.75, tickers: ["IDX-ALPHA", "IDX-BETA", "IDX-GAMMA", "IDX-DELTA"] },
  trainTrend: { vol: 1.0, tickers: ["TRN-MOMO", "TRN-DRIFT", "TRN-GRIND", "TRN-RUNNR"] },
  trainChop: { vol: 1.15, tickers: ["CHOP-1", "CHOP-2", "CHOP-3", "CHOP-4"] },
};

// ── MISSIONS: a data-driven registry — every mission is an evaluator ─────────
export type MissionKey =
  | "beat" | "momentum" | "short" | "survivor" | "lowrisk"
  | "breakout" | "contrarian" | "newsTrader" | "volatility" | "allOrNothing";

export type MissionCtx = {
  roundPct: number; spyPct: number; maxDD: number; trades: number; wins: number;
  shortWins: number; bestRiserWin: boolean; oppWin: boolean; contraWin: boolean;
  reactionsCorrect: number; allOrNothingHit: boolean; margin: boolean;
  /** fraction of the day with any position open — SURVIVOR requires presence */
  exposureFrac: number;
};

export const MISSIONS: Record<MissionKey, { label: string; evalFn: (c: MissionCtx) => boolean }> = {
  beat: { label: "BEAT THE MARKET — finish above the INDEX line", evalFn: (c) => c.roundPct > c.spyPct },
  momentum: { label: "MOMENTUM HUNTER — sell the day's fastest riser at +3% or better", evalFn: (c) => c.bestRiserWin },
  short: { label: "SHORT SELLER — book two profitable shorts", evalFn: (c) => c.shortWins >= 2 },
  survivor: { label: "SURVIVOR — stay in the market (60%+ of the day) and never breach 20% drawdown", evalFn: (c) => !c.margin && c.maxDD < 20 && c.exposureFrac >= 0.6 },
  lowrisk: { label: "LOW RISK — finish green with max drawdown under 5%", evalFn: (c) => c.roundPct >= 0 && c.maxDD < 5 },
  breakout: { label: "BREAKOUT — take the opportunity window and close it green", evalFn: (c) => c.oppWin },
  contrarian: { label: "CONTRARIAN — book a win trading AGAINST a headline", evalFn: (c) => c.contraWin },
  newsTrader: { label: "NEWS TRADER — react correctly to 3 events", evalFn: (c) => c.reactionsCorrect >= 3 },
  volatility: { label: "VOLATILITY DESK — book 2 wins at 50%+ accuracy, finish green", evalFn: (c) => c.wins >= 2 && c.trades > 0 && c.wins / c.trades >= 0.5 && c.roundPct > 0 },
  allOrNothing: { label: "ALL OR NOTHING — bank +15% realized before equity touches −5%", evalFn: (c) => c.allOrNothingHit },
};

// ── the calendar: rounds are DAYS, five days clear the WEEK ──────────────────
export type RoundDef = {
  n: number; name: string; missionKey: MissionKey;
  weather: string;
  bias: "BULLISH" | "BEARISH" | "MIXED";
  secs: number; tps: number;
  stocks: number; cats: string[]; shorts: boolean; positions: number;
  /** event load: clued-or-breaking news + opportunity windows */
  news: number; opps: number;
  vol: number;
  netMin: number; netMax: number;
  minDD: number; minRally: number;
  spyNet: [number, number];
  capBelowSpy?: number;
  crash?: boolean;
  /** position sizing UI unlocked (week-gated; engine always supports frac) */
  sizing?: boolean;
};

export const LADDER: RoundDef[] = [
  {
    n: 1, name: "OPENING BELL", missionKey: "beat",
    weather: "QUIET OPEN — a drift with a bid under it. Nothing outruns the index by standing still.",
    bias: "BULLISH",
    secs: 90, tps: 6, stocks: 4, cats: ["mega", "consumer", "banks", "tech"], shorts: false, positions: 1,
    news: 1, opps: 0, vol: 0.0035, netMin: -3.5, netMax: 99, minDD: 4, minRally: 4, spyNet: [0.8, 1.6], capBelowSpy: 0.8,
  },
  {
    n: 2, name: "MOMENTUM", missionKey: "momentum",
    weather: "MOMENTUM TAPE — runners run, then get faded. Sell into strength or ride it back down.",
    bias: "MIXED",
    secs: 80, tps: 7, stocks: 4, cats: ["tech", "semi", "highvol", "mega"], shorts: true, positions: 1,
    news: 1, opps: 1, vol: 0.005, netMin: -6, netMax: 7, minDD: 5, minRally: 7, spyNet: [-0.5, 1.5],
  },
  {
    n: 3, name: "EARNINGS", missionKey: "short",
    weather: "EARNINGS WEEK — headlines hit mid-session. The clue prints before the move. Sometimes it lies.",
    bias: "MIXED",
    secs: 75, tps: 8, stocks: 4, cats: ["tech", "semi", "health", "consumer"], shorts: true, positions: 2,
    news: 2, opps: 1, vol: 0.0055, netMin: -6, netMax: 5, minDD: 6, minRally: 6, spyNet: [-1, 1],
  },
  {
    n: 4, name: "THE CRASH", missionKey: "survivor",
    weather: "FED DAY — everything's twitchy. The bounces are traps; so is the hole.",
    bias: "BEARISH",
    secs: 45, tps: 10, stocks: 4, cats: ["banks", "energy", "mega", "highvol"], shorts: true, positions: 2,
    news: 2, opps: 0, vol: 0.007, netMin: -26, netMax: -14, minDD: 30, minRally: 25, spyNet: [-12, -7], crash: true,
  },
  {
    n: 5, name: "FRIDAY — OPEX", missionKey: "lowrisk",
    weather: "FRIDAY — OPEX. Pinned for stretches, then violent. Small book, quick hands.",
    bias: "MIXED",
    secs: 120, tps: 9, stocks: 5, cats: ["highvol", "crypto", "semi", "tech", "mega"], shorts: true, positions: 2,
    news: 3, opps: 1, vol: 0.006, netMin: -8, netMax: 8, minDD: 7, minRally: 8, spyNet: [-2, 2],
  },
];

/** WEEK unlocks + mission rotation — progression stays on the calendar.
 *  W2: POSITION SIZING · W3: SECOND BOOK + bigger universe · W4: HEAVY NEWS.
 *  Missions rotate at W2+ so the same day plays differently week to week. */
export const WEEK_PERKS: Record<number, string> = {
  2: "POSITION SIZING — 25/50/75/100% orders + ADD tranches",
  3: "SECOND BOOK — 2 positions from day 1 · crypto + high-vol join the rotation",
  4: "HEAVY NEWS TAPE — one extra headline every day",
  5: "OPERATOR DESK — options architecture on deck",
};
const MISSION_ROTATIONS: MissionKey[][] = [
  ["beat", "momentum", "short", "survivor", "lowrisk"],       // W1 (base)
  ["beat", "breakout", "newsTrader", "survivor", "allOrNothing"], // W2
  // contrarian lives on day 3: shorts are open there, so "against the
  // headline" is always a legal trade whichever way the headline points
  ["beat", "momentum", "contrarian", "survivor", "lowrisk"], // W3
];
export function missionFor(day: number, week: number): MissionKey {
  const rot = week <= 1 ? MISSION_ROTATIONS[0] : MISSION_ROTATIONS[1 + ((week - 2) % 2)];
  return rot[day - 1] ?? "beat";
}

export function weekAdjust(def: RoundDef, week: number): RoundDef {
  const swapIn = (cats: string[], cat: string, ix: number) =>
    cats.includes(cat) ? cats : cats.map((c, k) => (k === ix ? cat : c));
  let d: RoundDef = { ...def, missionKey: missionFor(def.n, week) };
  if (week >= 2) d.sizing = true;
  if (week >= 3) {
    if (def.n === 2 || def.n === 3) d = { ...d, cats: swapIn(d.cats, "crypto", d.cats.length - 1) };
    if (def.n <= 3) d = { ...d, cats: swapIn(d.cats, "highvol", 2) };
    if (d.positions < 2) d = { ...d, positions: 2 };
  }
  if (week >= 4) d = { ...d, news: d.news + 1 };
  // a newsTrader day needs at least 3 headlines to react to
  if (d.missionKey === "newsTrader" && d.news < 3) d = { ...d, news: 3 };
  return d;
}

// ── EVENTS: archetype copy only, SIM chip lives in the UI ────────────────────
type EventCopy = { label: string; dir: 1 | -1 };
const NEWS_COPY: EventCopy[] = [
  { label: "GUIDANCE RAISED", dir: 1 },
  { label: "GUIDANCE CUT", dir: -1 },
  { label: "EARNINGS BEAT", dir: 1 },
  { label: "EARNINGS MISS", dir: -1 },
  { label: "ANALYST UPGRADE", dir: 1 },
  { label: "ANALYST DOWNGRADE", dir: -1 },
  { label: "SHORT SQUEEZE — ×2 WINDOW", dir: 1 },
  { label: "EXPORT RESTRICTION HEADLINE", dir: -1 },
  { label: "SUPPORT BREAK", dir: -1 },
  { label: "RESISTANCE BREAKOUT", dir: 1 },
];
const SECTOR_COPY: EventCopy[] = [
  { label: "SECTOR ROTATION — MONEY IN", dir: 1 },
  { label: "SECTOR ROTATION — MONEY OUT", dir: -1 },
  { label: "SECTOR UPGRADE", dir: 1 },
  { label: "SECTOR SELLOFF", dir: -1 },
];
const MARKET_COPY: EventCopy[] = [
  { label: "MARKET RALLY", dir: 1 },
  { label: "MARKET SELLOFF", dir: -1 },
];

export type EventKind = "news" | "opportunity";
export type EventScope = "stock" | "sector" | "market";
export type GameEvent = {
  id: number;
  kind: EventKind;
  scope: EventScope;
  /** affected stock indices — first entry is the primary */
  stocks: number[];
  /** impulse begins + card reveals */
  at: number;
  /** clued news warns ~5s ahead; breaking news doesn't */
  clueAt: number | null;
  /** opportunity trade window in ticks (0 for news) */
  windowTicks: number;
  label: string;
  eyebrow: "BREAKING" | "ALERT" | "OPPORTUNITY";
  /** what the headline implies */
  headlineDir: 1 | -1;
  /** what the tape actually does — misleading events differ (#10) */
  actualDir: 1 | -1;
  misleading: boolean;
  /** impulse magnitude, % on the primary stock */
  mag: number;
  hit: boolean;
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Stock = { ticker: string; prices: number[] };

// ── tape v2 internals ────────────────────────────────────────────────────────

const MAX_STREAK = 6;

type Wp = { t: number; v: number };

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
  let t = Math.max(1, Math.min(wp.t, wps[wps.length - 1].t - 1));
  // NEVER replace an existing waypoint — macro pins carry the fairness
  // guarantees (a collision once let an event overwrite the crash trough)
  while (t < wps[wps.length - 1].t - 1 && wps.some((w) => w.t === t)) t += 1;
  const ix = wps.findIndex((w) => w.t >= t);
  if (ix <= 0 || wps[ix].t === t) return;
  wps.splice(ix, 0, { t, v: wp.v });
}

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
    out[b.t] = b.v;
  }
  return out;
}

function capStreaks(path: number[], cap: number): void {
  let streak = 0, prev = 0;
  for (let k = 1; k < path.length - 1; k++) {
    const d = path[k] - path[k - 1];
    const s = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (s === 0) continue;
    if (s === prev) streak += 1; else { streak = 1; prev = s; }
    if (streak > cap) {
      path[k] -= s * Math.abs(d) * 1.4;
      streak = 1; prev = -s;
    }
  }
}

function addTexture(wps: Wp[], N: number, tps: number, vol: number, tune: PitTune, rng: () => number): void {
  const spacing = Math.max(4 * tps, Math.floor(N / 10));
  for (let t = spacing; t < N - spacing; t += spacing) {
    if (rng() > 0.65 * tune.retrace) continue;
    const t0 = t + Math.floor((rng() - 0.5) * spacing * 0.6);
    const dur = Math.max(Math.floor(0.8 * tps), Math.floor((0.8 + rng() * 0.7) * tps));
    if (t0 + dur * 2 >= N - 2) continue;
    const dir = rng() < 0.5 ? 1 : -1;
    const mag = (0.9 + rng() * 1.6) * vol * tps * 1.8 * tune.vol;
    const base = wpAt(wps, t0 + dur);
    const fake = rng() < 0.3;
    const retrace = fake ? 1.3 + rng() * 0.4 : 0.3 + rng() * 0.3;
    insertWp(wps, { t: t0 + dur, v: base + dir * mag });
    insertWp(wps, { t: t0 + dur + Math.max(2, Math.floor(dur * (0.8 + rng() * 0.6))), v: base + dir * mag * (1 - retrace) });
  }
}

function stockWaypoints(def: RoundDef, N: number, tune: PitTune, spyNet: number, rng: () => number): Wp[] {
  const L = (pct: number) => Math.log(1 + pct / 100);
  if (def.crash) {
    const fall = 30 + rng() * 8;
    const t1 = Math.floor((0.3 + rng() * 0.12) * N);
    const trapTop = -1 + rng() * 5;
    const t2 = t1 + Math.floor((0.16 + rng() * 0.1) * N);
    const net = -(14 + rng() * 12) * tune.drift;
    const wps: Wp[] = [{ t: 0, v: 0 }, { t: t1, v: L(-fall) }, { t: t2, v: L(trapTop) }, { t: N - 1, v: L(net) }];
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
    wps.push({ t: t1, v: L(-dd) });
    wps.push({ t: t2, v: L(-dd) + L(rally) });
  } else {
    wps.push({ t: t1, v: L(rally) });
    wps.push({ t: t2, v: L(rally) + L(-dd) });
  }
  wps.push({ t: N - 1, v: L(net) });
  return wps;
}

/** schedule the day's events, spread out, deterministic */
function planEvents(def: RoundDef, N: number, tune: PitTune, rng: () => number): GameEvent[] {
  const events: GameEvent[] = [];
  const taken: number[] = [];
  const slot = (): number => {
    for (let tries = 0; tries < 20; tries++) {
      const at = Math.floor((0.2 + rng() * 0.6) * N);
      if (taken.every((t) => Math.abs(t - at) > 9 * def.tps)) { taken.push(at); return at; }
    }
    const at = Math.floor((0.2 + rng() * 0.6) * N);
    taken.push(at);
    return at;
  };
  let id = 0;
  for (let k = 0; k < def.news; k++) {
    const scopeRoll = rng();
    const scope: EventScope = scopeRoll < 0.6 ? "stock" : scopeRoll < 0.85 ? "sector" : "market";
    const pool = scope === "stock" ? NEWS_COPY : scope === "sector" ? SECTOR_COPY : MARKET_COPY;
    const copy = pool[Math.floor(rng() * pool.length)];
    const primary = Math.floor(rng() * def.stocks);
    const stocks =
      scope === "stock" ? [primary] :
      scope === "sector" ? [primary, (primary + 1) % def.stocks] :
      Array.from({ length: def.stocks }, (_, s) => s);
    const misleading = scope !== "market" && rng() < 0.27;
    const at = slot();
    events.push({
      id: id++, kind: "news", scope, stocks, at,
      clueAt: rng() < 0.5 ? at - 5 * def.tps : null, // half clued, half breaking
      windowTicks: 0,
      label: copy.label,
      eyebrow: scope === "stock" ? "BREAKING" : "ALERT",
      headlineDir: copy.dir,
      actualDir: misleading ? (copy.dir === 1 ? -1 : 1) : copy.dir,
      misleading,
      // the calm opening day gets smaller headlines
      mag: (2.5 + rng() * 1.5) * tune.events * (def.n === 1 ? 0.6 : 1),
      hit: false,
    });
  }
  for (let k = 0; k < def.opps; k++) {
    const primary = Math.floor(rng() * def.stocks);
    const fake = rng() < 0.35; // the fake breakout — first-class (#10)
    events.push({
      id: id++, kind: "opportunity", scope: "stock", stocks: [primary], at: slot(),
      clueAt: null, windowTicks: 12 * def.tps,
      label: "BREAKOUT DETECTED", eyebrow: "OPPORTUNITY",
      headlineDir: 1, actualDir: fake ? -1 : 1, misleading: fake,
      mag: (2 + rng() * 1.5) * tune.events,
      hit: false,
    });
  }
  return events.sort((a, b) => a.at - b.at);
}

export function makeRound(
  def: RoundDef,
  runSeed: number,
  tune: PitTune = DEFAULT_TUNE,
): { stocks: Stock[]; spy: number[]; events: GameEvent[]; spyNet: number } {
  const rng = mulberry32(runSeed * 7919 + def.n * 104729);
  const N = def.secs * def.tps;
  const L = (pct: number) => Math.log(1 + pct / 100);

  const spyNet = def.spyNet[0] + rng() * (def.spyNet[1] - def.spyNet[0]);
  const spyWps: Wp[] = [{ t: 0, v: 0 }];
  if (def.crash) {
    spyWps.push({ t: Math.floor(N * 0.45), v: L(spyNet * 1.6) });
    spyWps.push({ t: Math.floor(N * 0.62), v: L(spyNet * 0.8) });
  }
  spyWps.push({ t: N - 1, v: L(spyNet) });

  const picks: Array<{ t: string; c: Cat }> = [];
  const used = new Set<string>();
  for (let s = 0; s < def.stocks; s++) {
    const cat = CATS[def.cats[s % def.cats.length]];
    let t = cat.tickers[Math.floor(rng() * cat.tickers.length)];
    while (used.has(t)) t = cat.tickers[Math.floor(rng() * cat.tickers.length)];
    used.add(t);
    picks.push({ t, c: cat });
  }

  const events = planEvents(def, N, tune, rng);

  // market events bend the index too
  for (const ev of events) {
    if (ev.scope !== "market") continue;
    const base = wpAt(spyWps, ev.at);
    const mag = L(ev.mag * 0.3) * ev.actualDir;
    insertWp(spyWps, { t: ev.at, v: base });
    insertWp(spyWps, { t: ev.at + Math.floor(1.2 * def.tps), v: base + mag });
    insertWp(spyWps, { t: ev.at + Math.floor(3.5 * def.tps), v: base + mag * 0.5 });
  }
  const spy = fillPath(spyWps, N, 0.0006, rng).map((v) => 100 * Math.exp(v));

  const stocks: Stock[] = picks.map((pk, idx) => {
    const vol = def.vol * pk.c.vol * tune.vol;
    const wps = stockWaypoints(def, N, tune, spyNet, rng);
    addTexture(wps, N, def.tps, vol, tune, rng);
    // event impulses: begin AT the reveal, land within ~1.2s, then partially
    // retrace — chasing the print buys the top (that's the fairness rail).
    // Opportunity impulses start inside the window so taking it early pays.
    for (const ev of events) {
      const ix = ev.stocks.indexOf(idx);
      if (ix < 0) continue;
      const scale = ev.scope === "market" ? 0.5 : ev.scope === "sector" && ix > 0 ? 0.7 : 1;
      const start = ev.kind === "opportunity" ? ev.at + Math.floor(ev.windowTicks * 0.45) : ev.at;
      const mag = L(ev.mag * scale) * ev.actualDir;
      const base = wpAt(wps, start);
      insertWp(wps, { t: start, v: base });
      insertWp(wps, { t: start + Math.floor(1.2 * def.tps), v: base + mag });
      // deep retrace (55–80%): chasing the print buys the top and gives most
      // of it back — the structural rail behind the event-chaser fairness law
      insertWp(wps, { t: start + Math.floor(3.5 * def.tps), v: base + mag * (0.2 + rng() * 0.25) });
    }
    const path = fillPath(wps, N, vol, rng);
    capStreaks(path, MAX_STREAK);
    const open = 40 + rng() * 260;
    return { ticker: pk.t, prices: path.map((v) => open * Math.exp(v)) };
  });

  return { stocks, spy, events, spyNet };
}

// ── the live day runtime ─────────────────────────────────────────────────────

export type Position = {
  dir: 1 | -1; entry: number; qty: number; worstPct: number;
  /** capital fraction spent across tranches, for the size readout */
  sizeFrac: number;
  /** set when opened against a live headline — feeds CONTRARIAN */
  contraEventId: number | null;
  /** set when opened inside an opportunity window — feeds BREAKOUT */
  oppEventId: number | null;
};
export type TradeMark = { s: number; tick: number; price: number; dir: 1 | -1; kind: "open" | "close"; gain?: number };
export type ReactionAction = "hold" | "exit" | "add";
export type PitEvent =
  | { type: "pop"; text: string; cls: 1 | -1 }
  | { type: "goodEntry"; stock: number }
  | { type: "catalyst"; stock: number }
  | { type: "panicSell"; stock: number }
  | { type: "stopOut"; stock: number }
  | { type: "diamondHands"; stock: number }
  | { type: "paperHands"; stock: number }
  | { type: "news"; event: GameEvent }
  | { type: "closedInfo"; stock: number; gain: number; worstPct: number }
  | { type: "reaction"; correct: boolean; action: ReactionAction }
  | { type: "streak"; count: number; xp: number };
export type TickEnd = "margin" | "bell" | "fund" | null;

export type RiskLevel = "LOW" | "MED" | "HIGH" | "EXTREME";
export type Grade = "A" | "B" | "C" | "D" | "—";

export type RoundSummary = {
  startEq: number; endEq: number; roundPct: number; spyPct: number; missionHit: boolean;
  score: number; parts: Array<[string, number]>; xp: number;
  bonus: Array<[string, number]>;
  trades: number; wins: number; winRate: number; goodEntries: number; maxDD: number; margin: boolean;
  /** best single deliberate-close gain, % (R1 A4 — never a hardcoded 0) */
  bestTrade: number;
  riskGrade: Grade; reactionGrade: Grade;
  reactionsCorrect: number; reactionsTotal: number;
  realizedPct: number; streak: number;
  /** earned stamp keys this day ("diamond" | "paper") — the share card picks */
  stamps: string[];
};

type PendingReaction = {
  eventId: number; stock: number; posDir: 1 | -1; priceAt: number;
  action: ReactionAction | null; deadline: number; evalAt: number;
};

type CarryState = {
  cash: number; positions: Array<Position | null>; peak: number; maxDD: number;
  trades: number; wins: number; goodEntries: number; shortWins: number; bestRiserWin: boolean;
  log: TradeMark[]; stamps: Set<string>;
  realized: number; streak: number; bonus: Array<[string, number]>;
  reactionsCorrect: number; reactionsTotal: number;
  oppWin: boolean; contraWin: boolean; allOrNothingHit: boolean; eqTouchedMinus5: boolean;
  riskAccum: number; riskSamples: number; exposureTicks: number; bestTrade: number;
};

export type RoundRun = {
  def: RoundDef;
  startEq: number;
  seed: number;
  tune: PitTune;
  stocks: Stock[];
  spy: number[];
  events: GameEvent[];
  positions: Array<Position | null>;
  log: TradeMark[];
  i: number;
  N: number;
  /** clued event currently in its warning window */
  clue: GameEvent | null;
  /** events currently showing their card (reveal ≤ i < reveal+6s, or the
   *  opportunity window) — newest last */
  activeEvents(): GameEvent[];
  /** the open reaction decision, if any (held stock hit by an event) */
  pendingReaction(): PendingReaction | null;
  px(s: number, k?: number): number;
  equity(): number;
  cash(): number;
  /** current risk read: exposure × vol personality of the held book */
  risk(): { level: RiskLevel; frac: number };
  /** frac = fraction of AVAILABLE cash (0..1]; same-dir act on a held stock
   *  ADDs a tranche at blended entry */
  act(s: number, dir: 1 | -1 | 0, frac?: number): void;
  /** answer the open reaction window explicitly */
  react(action: ReactionAction): void;
  tick(): TickEnd;
  finish(margin: boolean): RoundSummary;
  _carry(): CarryState;
};

export function createRoundRun(
  def: RoundDef,
  runSeed: number,
  startEq: number,
  onEvent: (ev: PitEvent) => void = () => {},
  opts?: {
    tune?: PitTune; initialStreak?: number;
    /** GAME-5: touching this equity ends the day instantly — THE FUND */
    fundAt?: number;
    carry?: CarryState & { opens: number[]; secsLeft: number };
  },
): RoundRun {
  const tune = opts?.tune ?? DEFAULT_TUNE;
  const carry = opts?.carry;
  let genDef = def;
  if (carry) {
    const frac = Math.max(0.25, carry.secsLeft / def.secs);
    genDef = {
      ...def,
      secs: Math.max(5, carry.secsLeft),
      news: 0, opps: 0, // fired events don't regenerate mid-retune
      minDD: def.minDD * frac, minRally: def.minRally * frac,
      netMin: def.netMin * frac, netMax: def.netMax === 99 ? 99 : def.netMax * frac,
      spyNet: [def.spyNet[0] * frac, def.spyNet[1] * frac],
    };
  }
  const made = makeRound(genDef, runSeed, tune);
  const stocks = made.stocks;
  if (carry) {
    for (let s = 0; s < stocks.length; s++) {
      const open = carry.opens[s];
      if (open === undefined) continue;
      const p0 = stocks[s].prices[0];
      stocks[s].prices = stocks[s].prices.map((p) => open * (p / p0));
    }
  }
  const { spy, events } = made;
  const N = genDef.secs * genDef.tps;

  let cash = carry ? carry.cash : startEq;
  const positions: Array<Position | null> = carry ? carry.positions : stocks.map(() => null);
  while (positions.length < stocks.length) positions.push(null);
  let peak = carry ? carry.peak : startEq;
  let maxDD = carry ? carry.maxDD : 0;
  let trades = carry ? carry.trades : 0;
  let wins = carry ? carry.wins : 0;
  let goodEntries = carry ? carry.goodEntries : 0;
  let shortWins = carry ? carry.shortWins : 0;
  let bestRiserWin = carry ? carry.bestRiserWin : false;
  const log: TradeMark[] = carry ? carry.log : [];
  const stamps = carry ? carry.stamps : new Set<string>();
  let realized = carry ? carry.realized : 0; // $ booked by deliberate closes
  let streak = carry ? carry.streak : (opts?.initialStreak ?? 0);
  const bonus: Array<[string, number]> = carry ? carry.bonus : [];
  let reactionsCorrect = carry ? carry.reactionsCorrect : 0;
  let reactionsTotal = carry ? carry.reactionsTotal : 0;
  let oppWin = carry ? carry.oppWin : false;
  let contraWin = carry ? carry.contraWin : false;
  let allOrNothingHit = carry ? carry.allOrNothingHit : false;
  let eqTouchedMinus5 = carry ? carry.eqTouchedMinus5 : false;
  let riskAccum = carry ? carry.riskAccum : 0;
  let riskSamples = carry ? carry.riskSamples : 0;
  let exposureTicks = carry ? carry.exposureTicks : 0;
  let bestTrade = carry ? carry.bestTrade : 0;
  let done = false;
  let settling = false;
  const watches: Array<{ s: number; price: number; dir: 1 | -1; until: number }> = [];
  const pendings: PendingReaction[] = [];
  const announced = new Set<number>();

  const px = (s: number, k?: number) =>
    stocks[s].prices[Math.max(0, Math.min(N - 1, k ?? run.i))];
  const equity = () =>
    cash + positions.reduce((sum, p, s) => (p ? sum + p.qty * (p.dir === 1 ? px(s) : 2 * p.entry - px(s)) : sum), 0);
  const openCount = () => positions.filter(Boolean).length;

  const catVolOf = (s: number): number => {
    const t = stocks[s].ticker;
    for (const c of Object.values(CATS)) if (c.tickers.includes(t)) return c.vol;
    return 1;
  };
  const risk = (): { level: RiskLevel; frac: number } => {
    const eq = equity();
    const exposure = eq > 0 ? Math.max(0, Math.min(1, 1 - cash / eq)) : 1;
    let volF = 0;
    for (let s = 0; s < positions.length; s++) if (positions[s]) volF = Math.max(volF, catVolOf(s) / 1.65);
    const dayF = Math.min(1.4, genDef.vol / 0.005);
    const frac = Math.max(0, Math.min(1, exposure * (0.35 + 0.65 * volF) * dayF));
    const level: RiskLevel = frac < 0.25 ? "LOW" : frac < 0.5 ? "MED" : frac < 0.75 ? "HIGH" : "EXTREME";
    return { level, frac };
  };

  const liveEventOn = (s: number): GameEvent | undefined =>
    events.find((ev) => ev.stocks.includes(s) && run.i >= ev.at && run.i < ev.at + 10 * genDef.tps);

  const act = (s: number, dir: 1 | -1 | 0, frac = 1): void => {
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
        trades += 1;
        if (gain > bestTrade) bestTrade = gain;
        realized += value - p.qty * p.entry * 1; // booked P&L in $ vs invested
        if (gain > 0) {
          wins += 1;
          streak += 1;
          if (streak === 3) { bonus.push(["3-TRADE STREAK", 250]); onEvent({ type: "streak", count: 3, xp: 250 }); }
          if (streak === 5) { bonus.push(["5-TRADE STREAK", 500]); onEvent({ type: "streak", count: 5, xp: 500 }); }
          if (p.dir === -1) shortWins += 1;
          if (p.contraEventId !== null) contraWin = true;
          if (p.oppEventId !== null) oppWin = true;
          const perf = stocks.map((st) => st.prices[Math.min(i, N - 1)] / st.prices[0]);
          // the riser must be SOLD INTO STRENGTH — +3% or better books it
          if (gain >= 3 && s === perf.indexOf(Math.max(...perf))) bestRiserWin = true;
        } else {
          streak = 0;
        }
        // ALL OR NOTHING: bank +15% realized before equity ever hit −5%
        if (!eqTouchedMinus5 && realized / startEq >= 0.15) allOrNothingHit = true;
        log.push({ s, tick: i, price, dir: p.dir, kind: "close", gain });
        onEvent({ type: "pop", text: `${gain >= 0 ? "+" : ""}${gain.toFixed(1)}% ${stocks[s].ticker}`, cls: gain >= 0 ? 1 : -1 });
        onEvent({ type: "closedInfo", stock: s, gain, worstPct: p.worstPct });
        // organic reaction: closing the watched stock inside the window = EXIT
        const pend = pendings.find((q) => q.stock === s && q.action === null && i <= q.deadline);
        if (pend) pend.action = "exit";
        if (gain > 0 && p.worstPct <= -8 && !stamps.has("diamond")) {
          stamps.add("diamond");
          onEvent({ type: "diamondHands", stock: s });
        } else if (gain <= -8) {
          onEvent({ type: "stopOut", stock: s });
        } else if (gain < 0) {
          let lo = Infinity, hi = -Infinity;
          for (let j = Math.max(0, i - 3 * genDef.tps); j <= i; j++) { lo = Math.min(lo, px(s, j)); hi = Math.max(hi, px(s, j)); }
          const atExtreme = p.dir === 1 ? price <= lo * 1.005 : price >= hi * 0.995;
          if (atExtreme) onEvent({ type: "panicSell", stock: s });
        }
        watches.push({ s, price, dir: p.dir, until: i + 6 * genDef.tps });
        if (dir !== 0) act(s, dir, frac); // flip: flatten then open the other way
      }
      return;
    }
    if (settling) return;
    const f = Math.max(0.25, Math.min(1, frac));
    if (p) {
      // ADD: same-direction tranche at blended entry
      if (p.dir !== dir || cash < 1) return;
      const stake = cash * f;
      const q2 = stake / price;
      p.entry = (p.entry * p.qty + price * q2) / (p.qty + q2);
      p.qty += q2;
      p.sizeFrac = Math.min(1, p.sizeFrac + f);
      cash -= stake;
      log.push({ s, tick: i, price, dir, kind: "open" });
      const pend = pendings.find((q) => q.stock === s && q.action === null && i <= q.deadline);
      if (pend) pend.action = "add";
      return;
    }
    if (openCount() >= def.positions || (dir === -1 && !def.shorts)) return;
    const stake = (cash / (def.positions - openCount())) * f;
    if (stake < 1) return;
    const live = liveEventOn(s);
    positions[s] = {
      dir, entry: price, qty: stake / price, worstPct: 0,
      sizeFrac: f,
      contraEventId: live && live.kind === "news" && dir !== live.headlineDir ? live.id : null,
      oppEventId: (() => {
        const opp = events.find((ev) => ev.kind === "opportunity" && ev.stocks[0] === s && i >= ev.at && i < ev.at + ev.windowTicks);
        if (opp) opp.hit = true;
        return opp ? opp.id : null;
      })(),
    };
    cash -= stake;
    log.push({ s, tick: i, price, dir, kind: "open" });
    let lo = Infinity, hi = -Infinity;
    const back = 4 * genDef.tps;
    for (let j = Math.max(0, i - back); j <= i; j++) { lo = Math.min(lo, px(s, j)); hi = Math.max(hi, px(s, j)); }
    const good = dir === 1 ? price <= lo * 1.02 : price >= hi * 0.98;
    if (good) { goodEntries += 1; onEvent({ type: "goodEntry", stock: s }); onEvent({ type: "pop", text: "GOOD ENTRY", cls: 1 }); }
    if (live && live.kind === "news" && ((live.actualDir === 1 && dir === 1) || (live.actualDir === -1 && dir === -1))) {
      live.hit = true;
      onEvent({ type: "catalyst", stock: s });
      onEvent({ type: "pop", text: "CATALYST CAPTURED", cls: 1 });
    }
  };

  const react = (action: ReactionAction): void => {
    const pend = pendings.find((q) => q.action === null && run.i <= q.deadline);
    if (!pend) return;
    if (action === "exit") { act(pend.stock, 0); pend.action = pend.action ?? "exit"; return; }
    if (action === "add") { act(pend.stock, pend.posDir, 0.25); pend.action = pend.action ?? "add"; return; }
    pend.action = "hold";
  };

  const tick = (): TickEnd => {
    if (done || run.i >= N - 1) return done ? null : "bell";
    run.i += 1;
    const i = run.i;
    run.clue = events.find((c) => c.clueAt !== null && i >= c.clueAt && i < c.at) ?? null;
    // event reveals → cards + reaction windows on held stocks
    for (const ev of events) {
      if (i < ev.at || announced.has(ev.id)) continue;
      announced.add(ev.id);
      onEvent({ type: "news", event: ev });
      for (const s of ev.stocks) {
        const p = positions[s];
        if (p && ev.kind === "news") {
          pendings.push({
            eventId: ev.id, stock: s, posDir: p.dir, priceAt: px(s),
            action: null, deadline: i + 6 * genDef.tps, evalAt: i + 8 * genDef.tps,
          });
        }
      }
    }
    // settle reaction windows: judged against what the tape did next
    for (let q = pendings.length - 1; q >= 0; q--) {
      const pend = pendings[q];
      if (i < pend.evalAt) continue;
      pendings.splice(q, 1);
      const move = (px(pend.stock) / pend.priceAt - 1) * pend.posDir * 100;
      const action: ReactionAction = pend.action ?? "hold";
      const correct = move >= 1 ? action !== "exit" : move <= -1 ? action === "exit" : true;
      reactionsTotal += 1;
      if (correct) reactionsCorrect += 1;
      onEvent({ type: "reaction", correct, action });
    }
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
    if (eq <= startEq * 0.95) eqTouchedMinus5 = true;
    riskAccum += risk().frac;
    riskSamples += 1;
    if (openCount() > 0) exposureTicks += 1;
    if (opts?.fundAt && eq >= opts.fundAt) return "fund";
    if (eq < startEq * MARGIN_FRAC) return "margin";
    if (run.i >= N - 1) return "bell";
    return null;
  };

  const finish = (margin: boolean): RoundSummary => {
    settling = true;
    positions.forEach((p, s) => p && act(s, 0));
    settling = false;
    done = true;
    const endEq = equity();
    const roundPct = (endEq / startEq - 1) * 100;
    const spyPct = (spy[Math.min(run.i, N - 1)] / spy[0] - 1) * 100;
    const ctx: MissionCtx = {
      roundPct, spyPct, maxDD, trades, wins, shortWins, bestRiserWin,
      oppWin, contraWin, reactionsCorrect, allOrNothingHit, margin,
      exposureFrac: riskSamples > 0 ? exposureTicks / riskSamples : 0,
    };
    const missionHit = margin ? false : MISSIONS[def.missionKey].evalFn(ctx);
    if (!margin && roundPct > spyPct) bonus.push(["MARKET BEATEN", 300]);
    if (!margin && trades >= 2 && wins === trades) bonus.push(["PERFECT DAY", 1000]);
    const parts: Array<[string, number]> = [
      ["P&L", Math.round(roundPct * 120)],
      ["MISSION", missionHit ? 2000 : 0],
      ["TIMING", goodEntries * 350],
      ["ACCURACY", trades ? Math.round((wins / trades) * 1200) : 0],
      ["DRAWDOWN", -Math.round(maxDD * 60)],
    ];
    const score = Math.max(0, parts.reduce((a, [, v]) => a + v, 0));
    const bonusXp = bonus.reduce((a, [, v]) => a + v, 0);
    const xp = Math.max(50, Math.round(score / 10) + (missionHit ? 120 : 0) + bonusXp);
    const avgRisk = riskSamples ? riskAccum / riskSamples : 0;
    const riskPts = (roundPct >= 0 ? 1 : 0) + (maxDD < 5 ? 1 : maxDD < 12 ? 0.5 : 0) + (avgRisk < 0.45 ? 1 : avgRisk < 0.7 ? 0.5 : 0);
    const riskGrade: Grade = riskPts >= 2.5 ? "A" : riskPts >= 1.5 ? "B" : riskPts >= 0.75 ? "C" : "D";
    const rr = reactionsTotal ? reactionsCorrect / reactionsTotal : null;
    const reactionGrade: Grade = rr === null ? "—" : rr >= 0.8 ? "A" : rr >= 0.6 ? "B" : rr >= 0.4 ? "C" : "D";
    return {
      startEq, endEq, roundPct, spyPct, missionHit, score, parts, xp, bonus,
      trades, wins, winRate: trades ? Math.round((wins / trades) * 100) : 0,
      goodEntries, maxDD, margin, riskGrade, reactionGrade,
      bestTrade: Math.round(bestTrade * 100) / 100,
      reactionsCorrect, reactionsTotal,
      realizedPct: Math.round((realized / startEq) * 10000) / 100,
      streak,
      stamps: [...stamps],
    };
  };

  const run: RoundRun = {
    def, startEq, seed: runSeed, tune, stocks, spy, events, positions, log,
    i: 0, N, clue: null,
    activeEvents: () => events.filter((ev) =>
      (ev.kind === "news" && run.i >= ev.at && run.i < ev.at + 6 * genDef.tps) ||
      (ev.kind === "opportunity" && run.i >= ev.at && run.i < ev.at + ev.windowTicks)),
    pendingReaction: () => pendings.find((q) => q.action === null && run.i <= q.deadline) ?? null,
    px, equity, cash: () => cash, risk, act, react, tick, finish,
    _carry: () => ({
      cash, positions, peak, maxDD, trades, wins, goodEntries, shortWins, bestRiserWin,
      log, stamps, realized, streak, bonus, reactionsCorrect, reactionsTotal,
      oppWin, contraWin, allOrNothingHit, eqTouchedMinus5, riskAccum, riskSamples, exposureTicks, bestTrade,
    }),
  };
  return run;
}

// ── GAME-5: the season frame — endings, the map, the rating ──────────────────

export const SEASON_WEEKS = 8;
export const FUND_TARGET = 100_000;

/** the map's named waypoints, week 1 → 8 */
export const WEEK_WAYPOINTS: string[] = [
  "OPENING WEEK", "SIZING DESK", "SECOND BOOK", "NEWS STORM",
  "EARNINGS SEASON", "THE GRIND", "VOL REGIME", "FINAL PRINT",
];

export type RunPos = { week: number; day: number };

/** PURE (S8). The career day seed — a avalanche mix of (runId, week, day).
 *  Every run gets fresh tapes for every day; nothing repeats across runs or
 *  players. Dailies/challenges deliberately DON'T use this: their seeds are
 *  shared by construction. */
export function careerDaySeed(runId: number, week: number, day: number): number {
  let h = (runId >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (week * 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ (day * 0x27d4eb2f), 0x165667b1);
  h ^= h >>> 15;
  return (h >>> 0) % 900_000_007;
}

/** PURE. The next day on the season calendar; "cleared" past Week 8 Day 5. */
export function advanceRun(pos: RunPos): RunPos | "cleared" {
  if (pos.day < LADDER.length) return { week: pos.week, day: pos.day + 1 };
  if (pos.week < SEASON_WEEKS) return { week: pos.week + 1, day: 1 };
  return "cleared";
}

/** PURE. Late-season heat — config on the existing tune surface, not a new
 *  mechanic: weeks past the first run gently hotter tapes and headlines. */
export function seasonTune(week: number, base: PitTune = DEFAULT_TUNE): PitTune {
  const h = Math.min(0.35, Math.max(0, (week - 1) * 0.05));
  return { ...base, vol: base.vol * (1 + h), events: base.events * (1 + h) };
}

export type RunAgg = {
  finalEq: number; trades: number; wins: number;
  worstDayDD: number; missionsHit: number; daysPlayed: number;
};
export type RatingLine = [label: string, read: string, points: number];

/** PURE. The PIT RATING — a deterministic composite with a visible breakdown.
 *  10 points across P&L, win rate, missions, drawdown → A+ … F. */
export function pitRating(a: RunAgg): { grade: string; points: number; lines: RatingLine[] } {
  const mult = a.finalEq / START_CASH;
  const pnlPts = mult >= 10 ? 4 : mult >= 3 ? 3 : mult >= 1.5 ? 2 : mult >= 1 ? 1 : 0;
  const wr = a.trades > 0 ? a.wins / a.trades : 0;
  const wrPts = wr >= 0.6 ? 2 : wr >= 0.45 ? 1 : 0;
  const mf = a.daysPlayed > 0 ? a.missionsHit / a.daysPlayed : 0;
  const mPts = mf >= 0.6 ? 2 : mf >= 0.3 ? 1 : 0;
  const ddPts = a.worstDayDD < 10 ? 2 : a.worstDayDD < 20 ? 1 : 0;
  const points = pnlPts + wrPts + mPts + ddPts;
  const grade = points >= 9 ? "A+" : points >= 8 ? "A" : points >= 6 ? "B" : points >= 4 ? "C" : points >= 2 ? "D" : "F";
  const lines: RatingLine[] = [
    ["RUN P&L", `${mult >= 1 ? "+" : ""}${((mult - 1) * 100).toFixed(0)}%`, pnlPts],
    ["WIN RATE", a.trades ? `${Math.round(wr * 100)}% of ${a.trades}` : "no trades", wrPts],
    ["MISSIONS", `${a.missionsHit}/${a.daysPlayed}`, mPts],
    ["WORST DAY DD", `-${a.worstDayDD.toFixed(1)}%`, ddPts],
  ];
  return { grade, points, lines };
}

/** T3 carry — retune a RUNNING day: fresh tape for the remaining clock at the
 *  current prices; cash/positions/stats carry. Already-fired events stay
 *  fired; unfired ones are dropped (owner tool). */
export function retuneRun(
  old: RoundRun,
  tune: PitTune,
  onEvent: (ev: PitEvent) => void = () => {},
): RoundRun {
  const secsLeft = Math.max(5, Math.round((old.N - old.i) / old.def.tps));
  const opens = old.stocks.map((_, s) => old.px(s));
  return createRoundRun(old.def, old.seed + old.i + 1, old.startEq, onEvent, {
    tune, carry: { ...old._carry(), opens, secsLeft },
  });
}
