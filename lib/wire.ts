// THE PUBLIC WIRE'S FAILURE VOCABULARY (fix/route-failure-honesty).
// DESIGN_LAWS L11 — FAILURE IS A STATE, NOT AN ABSENCE.
//
// Every public list route used to answer `{ ok: true, <rows>: [] }` whether the
// store was empty or unreachable. The two are different answers to different
// questions, and the consumers already HAVE the states to tell them apart —
// HomeBrief renders "the ideas board is unreachable" with its chip, and the
// terminal renders UNREACHABLE — but those only ever fired on a transport
// error, because a Redis outage arrived as a perfectly well-formed 200 saying
// there was nothing there.
//
// THREE ANSWERS, never two:
//   ok        — the source answered. Zero rows means zero rows.
//   partial   — some sources answered and some did not. The rows that exist
//               are served AND the dead ones are named; a clean list that
//               quietly omits them is the lie this branch exists to remove.
//   unavailable — nothing answered. The route says so, with the cause.
//
// A read that fails is `unavailable`, not an empty `ok`. A read that returns
// nothing is `ok` with no rows. Nothing in this file guesses which.

/** A source that did not answer, named, with the cause when it is known. */
export type SourceFailure = {
  /** the source as a reader would name it — "Upstash", "BBC", "AP" */
  source: string;
  /** why it didn't answer; "" when the cause is genuinely unknown */
  reason: string;
};

/** What a store/feed read returns. `failed` is non-empty only on a PARTIAL
 *  read: rows exist, and these sources are missing from them. */
export type WireRead<T> =
  | { state: "ok"; rows: T[]; failed: SourceFailure[] }
  | { state: "unavailable"; reason: string };

/** PURE. The rows that DID answer, with the sources that didn't. */
export function wireOk<T>(rows: T[], failed: SourceFailure[] = []): WireRead<T> {
  return { state: "ok", rows, failed };
}

/** PURE. Nothing answered. */
export function wireDown<T>(reason: string): WireRead<T> {
  return { state: "unavailable", reason: reason.trim() || "the source didn't answer" };
}

/** PURE. An error of any shape reduced to one honest sentence. Never empty:
 *  "it failed and we don't know why" is still a cause, and it is never
 *  rendered as silence. */
export function causeOf(e: unknown, fallback = "the source didn't answer"): string {
  // an Error answers with its message or not at all: String(someError) yields
  // "Error:" for a blank message, which reads like a cause and is not one
  if (e instanceof Error) return e.message.trim() || fallback;
  if (typeof e === "string" && e.trim()) return e.trim();
  if (e !== null && e !== undefined) {
    const s = String(e).trim();
    if (s && s !== "[object Object]") return s;
  }
  return fallback;
}

/** The HTTP status a failed read answers with. 503: the desk is reachable,
 *  the source behind it is not, and the answer may differ on a retry. */
export const WIRE_DOWN_STATUS = 503;

// ── what a PUBLIC wire may say about a failure ──────────────────────────────
// L11 asks for the cause "where it is known", and the cause of a store outage
// IS known — but the store's own words are `ECONNREFUSED ...` or a driver
// message carrying our key namespace and the literal command. These routes are
// unauthenticated and republished, so that text is infrastructure detail, not
// a desk fact. The split is the same one /api/admin/transcripts makes in the
// other direction: the admin console gets the provider's words because it is
// gated and the operator acts on them; the public wire gets the fact that the
// store did not answer, and the raw cause goes to the log where it belongs.
// The READER loses nothing — "unreachable" is the whole of what they can act
// on — and the operator loses nothing either.

/** What a reader is told when the desk's own store is unreachable. */
export const STORE_DOWN = "the desk's store didn't answer";
/** What a reader is told when the store was never configured. */
export const STORE_UNCONFIGURED = "the desk's store isn't configured";

/** Log the real cause where the operator can find it, and return the read a
 *  PUBLIC route may publish. Never inline the store's words into the body. */
export function storeDown<T>(where: string, e: unknown): WireRead<T> {
  console.error(`[${where}] store read failed:`, causeOf(e));
  return wireDown<T>(STORE_DOWN);
}

/** PURE. The reader-facing reason for a PARTIAL store read: how much of the
 *  answer is missing, in rows. A count is honest and carries no internals. */
export function rowsUnread(unread: number, total: number): string {
  return `${unread} of ${total} row${total === 1 ? "" : "s"} didn't read`;
}

/** PURE. The JSON body for every one of these routes, given a read and the
 *  key its rows ride under ("ideas", "headlines", "entries", "ingests").
 *
 *  `degraded` appears ONLY on a partial read — its presence is the signal, so
 *  a consumer can branch on it without counting. Extra fields (a disclaimer, a
 *  mode) merge in on success; a failure answers with nothing but the failure,
 *  because a disclaimer attached to rows that don't exist is noise. */
export function wireBody<T>(
  read: WireRead<T>,
  key: string,
  extra: Record<string, unknown> = {},
): { body: Record<string, unknown>; status: number } {
  if (read.state === "unavailable") {
    return { body: { ok: false, error: read.reason }, status: WIRE_DOWN_STATUS };
  }
  const body: Record<string, unknown> = { ok: true, [key]: read.rows, ...extra };
  if (read.failed.length > 0) body.degraded = read.failed;
  return { body, status: 200 };
}

// ── the consumer half ───────────────────────────────────────────────────────
// Clients read the SAME vocabulary, so a 200-with-`ok:false` and a 503 reach
// the same state. Both are "the source didn't answer" — the status is a
// transport fact, the body is the desk's own answer, and the body wins when
// it is present.

/** What a consumer got back. `reason`/`failed` are what the surface names. */
export type WireFetch<T> =
  | { state: "ok"; rows: T[]; failed: SourceFailure[] }
  | { state: "unavailable"; reason: string };

function asFailures(v: unknown): SourceFailure[] {
  if (!Array.isArray(v)) return [];
  const out: SourceFailure[] = [];
  for (const f of v) {
    if (f && typeof f === "object") {
      const o = f as Record<string, unknown>;
      if (typeof o.source === "string" && o.source.trim()) {
        out.push({ source: o.source.trim(), reason: typeof o.reason === "string" ? o.reason : "" });
      }
    }
  }
  return out;
}

/** PURE. Read one of these responses the way every consumer must.
 *
 *  `res` is null when the fetch itself threw — indistinguishable to the reader
 *  from the desk answering "unavailable", and treated the same. A body that
 *  says `ok: false` is a failure EVEN ON A 200, which is the whole point: the
 *  transport succeeding says nothing about whether the source answered. */
export function readWire<T>(
  res: { ok: boolean; status: number } | null,
  body: unknown,
  key: string,
): WireFetch<T> {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const stated = b && typeof b.error === "string" && b.error.trim() ? b.error.trim() : null;

  if (b && b.ok === false) {
    return { state: "unavailable", reason: stated ?? "the desk didn't answer" };
  }
  if (!res || !res.ok) {
    return { state: "unavailable", reason: stated ?? (res ? `the desk answered ${res.status}` : "the desk couldn't be reached") };
  }
  if (!b || b.ok !== true) {
    return { state: "unavailable", reason: stated ?? "the desk's answer couldn't be read" };
  }
  const rows = Array.isArray(b[key]) ? (b[key] as T[]) : [];
  return { state: "ok", rows, failed: asFailures(b.degraded) };
}

/** What a list surface may claim right now. The distinction that matters is
 *  the last two: EMPTY is a factual claim about the product ("the desk has
 *  published nothing") and UNREACHABLE is a claim about the read.
 *
 *  `answered` means a read has landed at least once — NOT that the latest one
 *  succeeded. That is the trap this function exists to close: a surface that
 *  polls spends most of an outage holding a successful read from before it
 *  started, so gating the failure state on "never answered once" means it only
 *  ever fires if the very FIRST poll failed. A book read empty at 09:00 says
 *  nothing about a store that died at 09:01. */
export type ListSurfaceState = "loading" | "unreachable" | "empty" | "rows";

/** PURE. The one place that decides it, so both surfaces decide it the same
 *  way and a regression is a failing test rather than a false claim on a
 *  phone. `failed` is the state of the LATEST read. */
export function listSurfaceState(input: {
  answered: boolean;
  failed: boolean;
  rows: number;
}): ListSurfaceState {
  if (input.rows > 0) return "rows"; // sticky-live: rows outlive a blip
  if (input.failed) return "unreachable";
  return input.answered ? "empty" : "loading";
}

/** PURE. One sentence naming the sources missing from a partial read, or null
 *  when nothing is missing. Reader-facing: names, not error text. */
export function degradedLine(failed: SourceFailure[]): string | null {
  if (failed.length === 0) return null;
  const names = [...new Set(failed.map((f) => f.source))];
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} didn't answer — this list is missing what they carry.`;
}
