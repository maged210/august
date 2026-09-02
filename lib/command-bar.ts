// THE COMMAND BAR's parser (feature/command-bar) — PURE, local, synchronous.
// Two lanes by LAW: everything this file classifies as a command is resolved
// deterministically by the client and NEVER touches /api/chat; only inputs it
// classifies as an ASK may reach the model. A ticker-shaped word that turns
// out not to exist returns NO SUCH SYMBOL at execution — it never falls
// through to the ask lane (the executor enforces it; the parser guarantees
// ticker-shaped inputs are classified as tickers, not asks).
//
// Matching: exact keywords and UNAMBIGUOUS prefixes only. An ambiguous prefix
// ("c" → call/coming/close/clear) is not a command; it falls to the ask lane
// like any other unknown input. Suggestions are local, mono caps, max 5.

export type CallSideWord = "HIGHER" | "LOWER";

export type ParsedCommand =
  | { kind: "ticker"; symbol: string }
  | { kind: "arm"; symbol: string }
  | { kind: "close"; symbol: string }
  | { kind: "call-side"; side: CallSideWord }
  | { kind: "nav"; target: "call" | "coming" | "why" | "pit" | "terminal" | "ideas" | "inbox" }
  | { kind: "clear" }
  | { kind: "forget" }
  /** a recognized command missing/garbling its argument — resolved LOCALLY
   *  with a usage hint, never sent to the model */
  | { kind: "incomplete"; command: "arm" | "close" }
  | { kind: "ask"; text: string };

// keyword → command factory. One flat table so prefix resolution is honest.
const KEYWORDS = [
  "higher",
  "lower",
  "call",
  "coming",
  "why",
  "pit",
  "terminal",
  "ideas",
  "inbox",
  "clear",
  "arm",
  "close",
] as const;
type Keyword = (typeof KEYWORDS)[number];

/** PURE. The single keyword an input prefixes UNAMBIGUOUSLY, or null. */
export function resolveKeyword(word: string): Keyword | null {
  const w = word.toLowerCase();
  if (!w) return null;
  const exact = KEYWORDS.find((k) => k === w);
  if (exact) return exact;
  const hits = KEYWORDS.filter((k) => k.startsWith(w));
  return hits.length === 1 ? hits[0] : null;
}

// Ticker-shaped: what a human types for a symbol — up to 5 letters, an
// optional ^ prefix (indices), or the Yahoo-style compound shapes (BRK-B,
// NQ=F, BTC-USD, DX-Y.NYB). Longer plain words ("thoughts", "breakdown") are
// prose and belong to the ask lane.
const TICKER_RE = /^\^?[A-Za-z]{1,5}(?:[.=-][A-Za-z0-9.]{1,6})?$/;

/** PURE. Would a symbol-expecting command accept this word? */
export function tickerShaped(word: string): boolean {
  return TICKER_RE.test(word);
}

/** PURE. Classify one input line. Empty input returns null (nothing to do). */
export function parseCommand(raw: string): ParsedCommand | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;

  // /forget stays — the one slash command (memory wipe, confirmed server-side)
  if (text.toLowerCase() === "/forget") return { kind: "forget" };

  const words = text.split(" ");

  if (words.length === 1) {
    const kw = resolveKeyword(words[0]);
    if (kw === "higher" || kw === "lower") {
      return { kind: "call-side", side: kw.toUpperCase() as CallSideWord };
    }
    if (kw === "clear") return { kind: "clear" };
    if (kw === "call" || kw === "coming" || kw === "why" || kw === "pit" || kw === "terminal" || kw === "ideas" || kw === "inbox") {
      return { kind: "nav", target: kw };
    }
    // "arm"/"close" alone: a recognized command missing its ticker — a local
    // usage hint, never a model call (command-shaped input stays local)
    if (kw === "arm" || kw === "close") return { kind: "incomplete", command: kw };
    // one ticker-shaped word → the ticker lane (validity decided at
    // execution: NO SUCH SYMBOL on a miss, never an ask)
    if (tickerShaped(words[0])) return { kind: "ticker", symbol: words[0].toUpperCase() };
    return { kind: "ask", text };
  }

  if (words.length === 2) {
    const kw = resolveKeyword(words[0]);
    if (kw === "arm" || kw === "close") {
      // a garbage argument is still a COMMAND attempt — hint locally
      return tickerShaped(words[1])
        ? { kind: kw, symbol: words[1].toUpperCase() }
        : { kind: "incomplete", command: kw };
    }
  }

  return { kind: "ask", text };
}

// --- suggestions -------------------------------------------------------------

const SUGGESTION_LABEL: Record<Keyword, string> = {
  higher: "HIGHER — take today's side vs AUGUST",
  lower: "LOWER — take today's side vs AUGUST",
  call: "CALL — jump to THE CALL",
  coming: "COMING — what's coming",
  why: "WHY — open the regime read",
  pit: "PIT",
  terminal: "TERMINAL",
  ideas: "IDEAS",
  inbox: "INBOX — owner",
  clear: "CLEAR — dismiss the card",
  arm: "ARM <TICKER> — owner",
  close: "CLOSE <TICKER> — owner",
};

export type Suggestion = { insert: string; label: string };

/** PURE, local, zero network. Up to 5 suggestions for the current input:
 *  keyword matches first, then known tickers (the live book, passed in by the
 *  caller) for bare or arm/close-prefixed symbol fragments. Mono caps. */
export function suggestFor(raw: string, knownTickers: string[] = []): Suggestion[] {
  const text = raw.replace(/\s+/g, " ").trimStart();
  if (!text) return [];
  const words = text.split(" ");
  const out: Suggestion[] = [];

  if (words.length === 1) {
    const w = words[0].toLowerCase();
    for (const k of KEYWORDS) {
      if (k.startsWith(w) && out.length < 5) {
        out.push({ insert: k === "arm" || k === "close" ? `${k} ` : k, label: SUGGESTION_LABEL[k] });
      }
    }
    const frag = words[0].toUpperCase();
    for (const t of knownTickers) {
      if (out.length >= 5) break;
      const T = t.trim().toUpperCase();
      if (T.startsWith(frag) && !out.some((s) => s.insert === T.toLowerCase())) {
        out.push({ insert: T.toLowerCase(), label: `${T} — open in the terminal` });
      }
    }
    return out.slice(0, 5);
  }

  if (words.length === 2) {
    const kw = resolveKeyword(words[0]);
    if (kw === "arm" || kw === "close") {
      const frag = words[1].toUpperCase();
      for (const t of knownTickers) {
        if (out.length >= 5) break;
        const T = t.trim().toUpperCase();
        if (T.startsWith(frag)) out.push({ insert: `${kw} ${T.toLowerCase()}`, label: `${kw.toUpperCase()} ${T}` });
      }
    }
  }
  return out.slice(0, 5);
}
