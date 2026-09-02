// THE COMMAND BAR's parser (feature/command-bar) — every command, prefixes,
// ticker-shaped misses, and THE LAW: nothing the parser classifies as a
// command can ever reach /api/chat (the zero-model-call assertion).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, resolveKeyword, suggestFor, tickerShaped } from "../lib/command-bar";

test("every command parses, exact form", () => {
  assert.deepEqual(parseCommand("NVDA"), { kind: "ticker", symbol: "NVDA" });
  assert.deepEqual(parseCommand("^vix"), { kind: "ticker", symbol: "^VIX" });
  assert.deepEqual(parseCommand("nq=f"), { kind: "ticker", symbol: "NQ=F" });
  assert.deepEqual(parseCommand("btc-usd"), { kind: "ticker", symbol: "BTC-USD" });
  assert.deepEqual(parseCommand("arm NVDA"), { kind: "arm", symbol: "NVDA" });
  assert.deepEqual(parseCommand("close uber"), { kind: "close", symbol: "UBER" });
  assert.deepEqual(parseCommand("higher"), { kind: "call-side", side: "HIGHER" });
  assert.deepEqual(parseCommand("lower"), { kind: "call-side", side: "LOWER" });
  assert.deepEqual(parseCommand("call"), { kind: "nav", target: "call" });
  assert.deepEqual(parseCommand("coming"), { kind: "nav", target: "coming" });
  assert.deepEqual(parseCommand("why"), { kind: "nav", target: "why" });
  assert.deepEqual(parseCommand("pit"), { kind: "nav", target: "pit" });
  assert.deepEqual(parseCommand("terminal"), { kind: "nav", target: "terminal" });
  assert.deepEqual(parseCommand("ideas"), { kind: "nav", target: "ideas" });
  assert.deepEqual(parseCommand("inbox"), { kind: "nav", target: "inbox" });
  assert.deepEqual(parseCommand("clear"), { kind: "clear" });
  assert.deepEqual(parseCommand("/forget"), { kind: "forget" });
  assert.equal(parseCommand("   "), null);
});

test("prefixes: unambiguous resolve, ambiguous fall through", () => {
  // unambiguous
  assert.equal(resolveKeyword("h"), "higher");
  assert.equal(resolveKeyword("lo"), "lower");
  assert.equal(resolveKeyword("w"), "why");
  assert.equal(resolveKeyword("t"), "terminal");
  assert.equal(resolveKeyword("p"), "pit");
  assert.equal(resolveKeyword("ca"), "call");
  assert.equal(resolveKeyword("com"), "coming");
  assert.equal(resolveKeyword("clo"), "close");
  assert.equal(resolveKeyword("cle"), "clear");
  assert.equal(resolveKeyword("id"), "ideas");
  assert.equal(resolveKeyword("in"), "inbox");
  assert.equal(resolveKeyword("a"), "arm");
  // ambiguous — NOT commands
  assert.equal(resolveKeyword("c"), null); // call/coming/close/clear
  assert.equal(resolveKeyword("cl"), null); // close/clear
  assert.equal(resolveKeyword("co"), "coming"); // only coming starts with "co"
  assert.equal(resolveKeyword("i"), null); // ideas/inbox
  assert.equal(resolveKeyword("l"), "lower"); // only lower starts with l
  // prefix commands parse whole
  assert.deepEqual(parseCommand("hi"), { kind: "call-side", side: "HIGHER" });
  assert.deepEqual(parseCommand("term"), { kind: "nav", target: "terminal" });
  assert.deepEqual(parseCommand("a NVDA"), { kind: "arm", symbol: "NVDA" });
});

test("ticker-shaped misses stay in the command lane — never an ask", () => {
  // ticker-shaped single words classify as tickers (validity is the
  // executor's job: a quote miss renders NO SUCH SYMBOL, not a model call)
  assert.deepEqual(parseCommand("hello"), { kind: "ticker", symbol: "HELLO" });
  assert.deepEqual(parseCommand("ZZZZZ"), { kind: "ticker", symbol: "ZZZZZ" });
  assert.equal(tickerShaped("hello"), true);
  assert.equal(tickerShaped("thoughts"), false); // 6+ plain letters = prose
  // recognized commands with a broken argument hint locally
  assert.deepEqual(parseCommand("arm"), { kind: "incomplete", command: "arm" });
  assert.deepEqual(parseCommand("close notatickerword"), { kind: "incomplete", command: "close" });
});

test("the ask lane gets only prose", () => {
  assert.deepEqual(parseCommand("what moved the tape today"), {
    kind: "ask",
    text: "what moved the tape today",
  });
  assert.equal(parseCommand("thoughts")!.kind, "ask"); // 8 plain letters = prose
  assert.equal(parseCommand("is NVDA a buy here")!.kind, "ask"); // multiword prose
  // ambiguous keyword prefixes are ticker-shaped and stay in the COMMAND
  // lane as symbols — "c" is Citigroup, "cl" is crude. Desk-correct, and it
  // keeps every short fragment away from the model.
  assert.deepEqual(parseCommand("c"), { kind: "ticker", symbol: "C" });
  assert.deepEqual(parseCommand("cl"), { kind: "ticker", symbol: "CL" });
});

test("THE LAW: the full command set never classifies as ask (zero /api/chat)", () => {
  const commandInputs = [
    "NVDA", "spy", "^VIX", "nq=f", "brk-b", "ZZZZ", // tickers, hit or miss
    "arm NVDA", "a spy", "close UBER", "clo dkng", // owner verbs + prefixes
    "arm", "close", "arm 123456789012", // incomplete — local hints
    "higher", "hi", "lower", "lo", // call sides
    "call", "ca", "coming", "com", "why", "w", // nav
    "pit", "p", "terminal", "t", "term", "ideas", "id", "inbox", "in",
    "clear", "cle", "/forget",
  ];
  for (const input of commandInputs) {
    const parsed = parseCommand(input);
    assert.ok(parsed, input);
    assert.notEqual(parsed!.kind, "ask", `"${input}" must never reach the model (got ask)`);
  }
});

test("suggestions: local, mono caps, max 5, tickers from the live book", () => {
  const tickers = ["NVDA", "NOW", "NEXT", "NU", "NKE", "NET"];
  const s = suggestFor("n", tickers);
  assert.ok(s.length <= 5);
  const c = suggestFor("c", []);
  assert.deepEqual(c.map((x) => x.insert), ["call", "coming", "clear", "close "]);
  assert.ok(c.every((x) => x.label === x.label.toUpperCase() || /—/.test(x.label)));
  const armS = suggestFor("arm n", tickers);
  assert.ok(armS.length > 0 && armS.length <= 5);
  assert.ok(armS.every((x) => x.insert.startsWith("arm n")));
  assert.deepEqual(suggestFor("", tickers), []);
  // a full prose line suggests nothing
  assert.deepEqual(suggestFor("what moved the tape", tickers), []);
});
