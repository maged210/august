// Resolve creator expiration wording → an actual date, anchored to the video's
// publish day in ET. Preserves the ORIGINAL wording and a confidence; returns
// resolved=null when it can't be safely determined (never guesses a date and
// attributes it to the creator). Pure + deterministic for tests.

import type { ResolvedDate } from "./types";

// ET calendar date key (YYYY-MM-DD) — same as session.etDateKey, inlined so this pure
// date module has no runtime imports (keeps it unit-testable under `node --test`).
const etDateKey = (d = new Date()): string => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const pad = (n: number) => String(n).padStart(2, "0");
const MS_DAY = 86_400_000;
// Anchor at UTC noon so plain day arithmetic never crosses a DST boundary.
const fromKey = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
};
const toKey = (t: number): string => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const dow = (t: number): number => new Date(t).getUTCDay(); // 0 Sun … 6 Sat

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Next occurrence of `weekday` strictly after `t` if `inclusive` is false, else >= t.
function nextWeekday(t: number, weekday: number, inclusive = true): number {
  const cur = dow(t);
  let delta = (weekday - cur + 7) % 7;
  if (delta === 0 && !inclusive) delta = 7;
  return t + delta * MS_DAY;
}

const r = (text: string, resolved: string | null, confidence: ResolvedDate["confidence"]): ResolvedDate => ({ text: text.trim(), resolved, confidence });

/** baseMs = the video's publish timestamp; tz handling via the ET date key. */
export function resolveExpiration(text: string, baseMs: number): ResolvedDate {
  const raw = (text || "").trim();
  if (!raw) return r(raw, null, "none");
  const s = raw.toLowerCase();
  const base = fromKey(etDateKey(new Date(baseMs)));

  // Explicit ISO date.
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return r(raw, `${m[1]}-${m[2]}-${m[3]}`, "high");

  // M/D or M/D/Y.
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);
  if (m) {
    const mo = Number(m[1]);
    const da = Number(m[2]);
    let yr = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : new Date(base).getUTCFullYear();
    // if the month already passed this year, assume next year
    if (!m[3] && Date.UTC(yr, mo - 1, da, 12) < base) yr += 1;
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return r(raw, `${yr}-${pad(mo)}-${pad(da)}`, "high");
  }

  // Month name + day ("july 3", "jul 3rd").
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[1]) + 1;
    const da = Number(m[2]);
    let yr = new Date(base).getUTCFullYear();
    if (Date.UTC(yr, mo - 1, da, 12) < base) yr += 1;
    return r(raw, `${yr}-${pad(mo)}-${pad(da)}`, "high");
  }

  // 0DTE / same-day.
  if (/\b0\s*dte\b/.test(s) || /\b(today|end of day|eod)\b/.test(s)) {
    return r(raw, toKey(base), dow(base) === 0 || dow(base) === 6 ? "low" : "high");
  }
  if (/\btomorrow\b/.test(s)) return r(raw, toKey(base + MS_DAY), "high");

  // this/next Friday (or other weekday).
  const wdNames: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  m = /\b(this|next|coming)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(s);
  if (m) {
    const wd = wdNames[m[2]];
    let target = nextWeekday(base, wd, true); // "this <day>" = the coming one (incl. today)
    if (m[1] === "next") target = nextWeekday(target, wd, false); // a week later
    const conf = m[1] ? "high" : "medium"; // bare weekday is a touch ambiguous
    return r(raw, toKey(target), conf);
  }

  // this/next week → that week's Friday.
  if (/\bnext week\b/.test(s)) {
    const thisFri = nextWeekday(base, 5, true);
    return r(raw, toKey(nextWeekday(thisFri, 5, false)), "medium");
  }
  if (/\bthis week\b/.test(s)) return r(raw, toKey(nextWeekday(base, 5, true)), "medium");

  // end of the month → the last Friday of the base month.
  if (/\b(end of (the )?month|eom|monthly)\b/.test(s)) {
    const d = new Date(base);
    const last = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12); // last day of month
    let fri = last;
    while (dow(fri) !== 5) fri -= MS_DAY;
    return r(raw, toKey(fri), "medium");
  }

  return r(raw, null, "none");
}

/** Days-to-expiration from an ISO date relative to now (ET calendar). */
export function dte(expiration: string | null, nowMs = Date.now()): number | null {
  if (!expiration) return null;
  const exp = fromKey(expiration);
  const now = fromKey(etDateKey(new Date(nowMs)));
  return Math.round((exp - now) / MS_DAY);
}
