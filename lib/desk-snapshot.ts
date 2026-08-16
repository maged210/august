// THE ANALYST'S GROUNDING (COMMAND CENTER R3) — one server-side snapshot of
// the APP'S OWN read, injected into the chat's dynamic system block. Every
// number here is what the surfaces actually display: the regime read with
// its because-list, NQ session levels, the live book, the latest headlines.
// Whatever fails or is absent is STATED as unavailable — the model is told
// to cite these and never to fabricate live numbers.

import { getDailyBars, getHistory, getQuoteWithSpark } from "@/lib/markets";
import { listLiveIdeas } from "@/lib/ideas";
import { getHeadlines } from "@/lib/headlines";
import { computeLevels, lastSession, levelsBias } from "@/lib/levels";
import { computeRegime, parseStatedLevel, sparkTrendPct, sparkTrendPts } from "@/lib/regime";

const settle = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function getDeskSnapshot(): Promise<string> {
  const [spy, qqq, vix, nq, ideas, headlines, daily, intradayToday] = await Promise.all([
    settle(getQuoteWithSpark("SPY")),
    settle(getQuoteWithSpark("QQQ")),
    settle(getQuoteWithSpark("^VIX")),
    settle(getQuoteWithSpark("NQ=F")),
    settle(listLiveIdeas()),
    settle(getHeadlines()),
    settle(getDailyBars("NQ=F")),
    settle(getHistory("NQ=F", "yahoo", "1D")),
  ]);

  const lines: string[] = [];

  // regime — the same math the home apex renders
  const longs = (ideas ?? []).filter((i) => i.side === "long").length;
  const shorts = (ideas ?? []).filter((i) => i.side === "short").length;
  const nqLevelsStated = (ideas ?? [])
    .filter((i) => /^NQ\b/i.test(i.instrument.trim()))
    .map((i) => parseStatedLevel(i.entry) ?? parseStatedLevel(i.target) ?? parseStatedLevel(i.stop))
    .filter((n): n is number => n !== null);
  const nqPx = nq && Number.isFinite(nq.price) ? nq.price : null;
  const avgStated = nqLevelsStated.length
    ? nqLevelsStated.reduce((a, b) => a + b, 0) / nqLevelsStated.length
    : null;
  const regime = computeRegime({
    spyTrendPct: sparkTrendPct(spy?.closes),
    qqqTrendPct: sparkTrendPct(qqq?.closes),
    vix: vix && Number.isFinite(vix.price) ? vix.price : null,
    vixTrendPts: sparkTrendPts(vix?.closes),
    bookLongs: longs,
    bookShorts: shorts,
    nqVsLevelPct: nqPx !== null && avgStated !== null ? ((nqPx - avgStated) / avgStated) * 100 : null,
  });
  if (regime.label === "UNAVAILABLE") {
    lines.push("MARKET REGIME: unavailable (fewer than 2 live inputs).");
  } else {
    lines.push(
      `MARKET REGIME (calculated, same read the home page shows): ${regime.label}` +
        (regime.agreement ? ` — ${regime.agreement.agree} of ${regime.agreement.voting} inputs agree` : "") +
        `. Because: ${regime.because.map((b) => `${b.input} ${b.value}`).join("; ")}.`,
    );
  }

  // pulse
  const q = (label: string, v: { price: number; chgPct: number } | null) =>
    v && Number.isFinite(v.price)
      ? `${label} ${v.price >= 1000 ? Math.round(v.price).toLocaleString("en-US") : v.price.toFixed(2)} (${v.chgPct >= 0 ? "+" : ""}${v.chgPct.toFixed(1)}%)`
      : `${label} unavailable`;
  lines.push(`PULSE (delayed ~60s): ${[q("SPY", spy), q("QQQ", qqq), q("NQ", nq), q("VIX", vix)].join(" · ")}.`);

  // NQ levels — same feed as the terminal module
  if (daily && daily.length) {
    const intraday =
      intradayToday && intradayToday.length >= 5
        ? intradayToday
        : lastSession((await settle(getHistory("NQ=F", "yahoo", "1W"))) ?? []);
    const levels = computeLevels(daily, intraday ?? []);
    const bias = levelsBias(levels);
    const lvl = (k: string, v: number | null) => (v !== null ? `${k} ${Math.round(v).toLocaleString("en-US")}` : `${k} unavailable`);
    lines.push(
      `NQ SESSION LEVELS: ${[lvl("prev high", levels.prevHigh), lvl("prev low", levels.prevLow), lvl("prev close", levels.prevClose), lvl("pivot", levels.pivot), lvl("VWAP", levels.vwap), lvl("overnight high", levels.onHigh), lvl("overnight low", levels.onLow)].join(" · ")}. Calculated condition: ${bias.label}.`,
    );
  } else {
    lines.push("NQ SESSION LEVELS: unavailable.");
  }

  // the live book
  if (ideas && ideas.length) {
    const rows = ideas.slice(0, 8).map((i) => {
      const side = i.side ? i.side.toUpperCase() : "no stated side";
      const bits = [i.entry && `entry ${i.entry}`, i.target && `target ${i.target}`, i.stop && `stop ${i.stop}`].filter(Boolean);
      return `${i.instrument} (${side}${bits.length ? ` — ${bits.join(", ")}` : ""})`;
    });
    lines.push(`LIVE DESK BOOK (${ideas.length} calls, ${longs} long / ${shorts} short): ${rows.join("; ")}.`);
  } else if (ideas) {
    lines.push("LIVE DESK BOOK: empty right now.");
  } else {
    lines.push("LIVE DESK BOOK: unavailable.");
  }

  // headlines
  if (headlines && headlines.length) {
    lines.push(`LATEST HEADLINES (free RSS): ${headlines.slice(0, 5).map((h) => `"${h.title}" (${h.publisher})`).join(" · ")}.`);
  } else {
    lines.push("HEADLINES: unavailable.");
  }

  return (
    `\n\n---\nTHE DESK'S OWN READ (cite THESE when answering market questions — they are what the app's surfaces display right now):\n` +
    lines.join("\n") +
    `\nRULES: quote these numbers as the app's data (delayed, not real-time). If something is marked unavailable, SAY it's unavailable. ` +
    `NEVER fabricate a live number, level, or headline that isn't in this block; for anything beyond it, say the desk doesn't carry that data.`
  );
}
