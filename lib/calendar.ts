// Google Calendar — SERVER ONLY. Read-only view of TODAY's events on the user's
// primary calendar, for AUGUST's awareness of the day (a restrained Presence line
// + a woven clause in the Morning Brief). NOT a calendar app: no grid, no writes.
//
// Reuses the SAME single OAuth client + token store as Gmail (lib/gmail.ts) via
// incremental authorization — the access token covers calendar.events.readonly once
// the user re-consents. Degrades gracefully at every seam: not connected / scope not
// granted / fetch failed all return a safe empty state, never throw. (The Morning
// Brief and the proactive push are DECOUPLED from this — they never gate on it.)
//
// NOTE: the Google Cloud project must have the Calendar API enabled (separate from
// Gmail) or events.list returns 403 accessNotConfigured — surfaced here as a clean
// "not connected" rather than an error.

import { CALENDAR_SCOPE, getGoogleAccessToken, oauthConfigured, scopeGranted } from "./gmail";

const CAL_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TZ = "America/New_York"; // Maged's day, same as the markets/brief layers
const DAY_TTL_MS = 5 * 60_000;

export type DayEvent = {
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location?: string;
};

export type DayState = {
  oauthConfigured: boolean;
  connected: boolean; // calendar scope granted AND fetch succeeded
  needsReconsent: boolean; // Google connected for Gmail but calendar scope not yet granted
  count: number; // today's events (declined/cancelled excluded)
  events: DayEvent[];
  nextUp?: { time: string; title: string }; // next or in-progress event, for Presence + teaser
  line: string; // restrained one-liner for the Presence center
};

// --- Eastern-time "today" bounds as RFC3339 (with offset) -----------------
// timeMin bounds an event's END and timeMax bounds its START, so [00:00 today,
// 00:00 tomorrow) in ET captures everything on today's agenda, incl. in-progress.
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== "literal") map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // some engines emit 24 at midnight
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUTC - date.getTime();
}

function zonedMidnight(dateKey: string, tz: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(utcGuess - tzOffsetMs(new Date(utcGuess), tz));
}

function etDayBounds(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD in ET
  const start = zonedMidnight(todayKey, TZ);
  const tomorrowKey = new Date(start.getTime() + 26 * 3600_000).toLocaleDateString("en-CA", {
    timeZone: TZ,
  });
  const end = zonedMidnight(tomorrowKey, TZ);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() }; // ...Z form is valid
}

function fmtTime(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, " "); // keep "9:00 AM" from wrapping in the Presence line
}

// --- Google Calendar shapes (only the fields we read) ---------------------
interface GCalTime {
  date?: string; // all-day: yyyy-mm-dd
  dateTime?: string; // timed: RFC3339
}
interface GCalEvent {
  summary?: string;
  start?: GCalTime;
  end?: GCalTime;
  location?: string;
  status?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
}

// The authenticated user declined this event → drop it from "today".
function selfDeclined(ev: GCalEvent): boolean {
  const me = ev.attendees?.find((a) => a.self);
  return me?.responseStatus === "declined";
}

function startMsOf(t: GCalTime | undefined): { ms: number; allDay: boolean } {
  if (t?.dateTime) return { ms: Date.parse(t.dateTime), allDay: false };
  if (t?.date) return { ms: zonedMidnight(t.date, TZ).getTime(), allDay: true };
  return { ms: 0, allDay: false };
}

function normalize(items: GCalEvent[]): DayEvent[] {
  const out: DayEvent[] = [];
  for (const ev of items) {
    if (ev.status === "cancelled" || selfDeclined(ev)) continue;
    const s = startMsOf(ev.start);
    const e = startMsOf(ev.end);
    if (!s.ms) continue;
    out.push({
      title: (ev.summary || "(busy)").replace(/\s+/g, " ").trim().slice(0, 120),
      startMs: s.ms,
      endMs: e.ms || s.ms,
      allDay: s.allDay,
      location: ev.location ? ev.location.replace(/\s+/g, " ").trim().slice(0, 120) : undefined,
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

// The next or currently-running timed event (all-day events don't make a "next").
function pickNextUp(events: DayEvent[], now: number): { time: string; title: string } | undefined {
  const ev = events.find((e) => !e.allDay && e.endMs > now);
  if (!ev) return undefined;
  const time = e_inProgress(ev, now) ? "now" : fmtTime(ev.startMs);
  return { time, title: ev.title };
}
const e_inProgress = (e: DayEvent, now: number) => e.startMs <= now && e.endMs > now;

function buildLine(connected: boolean, count: number, nextUp?: { time: string; title: string }): string {
  if (!connected) return "";
  if (!count) return "DAY CLEAR";
  if (nextUp) {
    const t = nextUp.title.toUpperCase().slice(0, 22);
    return nextUp.time === "now" ? `NOW · ${t}` : `NEXT ${nextUp.time} · ${t}`;
  }
  return count === 1 ? "1 TODAY" : `${count} TODAY`;
}

// --- in-process cache (mirrors the inbox layer) ---------------------------
// Per-user (stage 2): keyed by session email so one user's day is never served
// to another from a warm instance; null email = the single-user fallback slot.
const cacheId = (email: string | null) => email ?? "__single_user__";
const _cache = new Map<string, { exp: number; state: DayState }>();

function emptyState(extra: Partial<DayState>): DayState {
  return {
    oauthConfigured: oauthConfigured(),
    connected: false,
    needsReconsent: false,
    count: 0,
    events: [],
    line: "",
    ...extra,
  };
}

export async function getDayState(userEmail: string | null): Promise<DayState> {
  const now = Date.now();
  const cached = _cache.get(cacheId(userEmail));
  if (cached && cached.exp > now) return cached.state;

  const auth = await getGoogleAccessToken(userEmail);
  if (!auth) return emptyState({}); // not connected to Google at all
  if (!scopeGranted(auth.scopes, CALENDAR_SCOPE)) {
    // Connected for Gmail but the calendar scope was never granted — the user needs
    // to re-consent (via the existing Google connect). Reported, never thrown.
    return emptyState({ needsReconsent: true });
  }

  const { timeMin, timeMax } = etDayBounds();
  const url =
    `${CAL_BASE}?` +
    new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true", // required for orderBy=startTime; expands recurrences
      orderBy: "startTime",
      maxResults: "50",
      timeZone: TZ,
    }).toString();

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      // 401 expired (refresh handled upstream next call) / 403 scope or API-not-enabled.
      // Either way, fail soft to "connected but nothing to show" without throwing.
      return emptyState({ needsReconsent: res.status === 403 });
    }
    const data = (await res.json()) as { items?: GCalEvent[] };
    const events = normalize(data.items ?? []);
    const nextUp = pickNextUp(events, now);
    const state: DayState = {
      oauthConfigured: oauthConfigured(),
      connected: true,
      needsReconsent: false,
      count: events.length,
      events,
      nextUp,
      line: buildLine(true, events.length, nextUp),
    };
    _cache.set(cacheId(userEmail), { exp: now + DAY_TTL_MS, state });
    return state;
  } catch {
    return emptyState({});
  }
}
