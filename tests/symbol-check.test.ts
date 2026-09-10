// fix/ticker-validation — the PURE half of symbol resolution: name folding,
// the untradeable-subject refusal, and the name-agreement test that catches a
// ticker recalled from model memory.
//
// The network half (Yahoo's chart endpoint via lib/markets.probeInstrument)
// is not mocked here, matching this repo's convention: it is verified live
// against real symbols and recorded in the commit. Upstash is unset for this
// file so the verdict cache no-ops.

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNTRADEABLE_SUBJECTS,
  foldName,
  isUntradeableSubject,
  namesAgree,
} from "../lib/symbol-check";

// --- foldName ---------------------------------------------------------------

test("foldName: strips punctuation and corporate suffixes to a comparable core", () => {
  assert.equal(foldName("Enphase Energy, Inc."), "enphase energy");
  assert.equal(foldName("Oklo Inc."), "oklo");
  assert.equal(foldName("Alamos Gold Inc."), "alamos gold");
  assert.equal(foldName("Lumentum Holdings Inc."), "lumentum");
  assert.equal(foldName("The Trade Desk, Inc."), "trade desk");
});

test("foldName: empty and junk fold to empty, never throw", () => {
  assert.equal(foldName(""), "");
  assert.equal(foldName("   "), "");
  assert.equal(foldName("!!!"), "");
});

// --- the untradeable-subject gate -------------------------------------------

test("untradeable: the reported failure — SpaceX is refused however it is spelled", () => {
  assert.equal(isUntradeableSubject("SpaceX"), true);
  assert.equal(isUntradeableSubject("spacex"), true);
  assert.equal(isUntradeableSubject("Space Exploration Technologies"), true);
  assert.equal(isUntradeableSubject("SPACEX"), true);
});

test("untradeable: the other common private names are refused too", () => {
  for (const n of ["OpenAI", "Stripe", "Anthropic", "ByteDance", "Databricks", "Blue Origin"]) {
    assert.equal(isUntradeableSubject(n), true, `${n} should be refused`);
  }
});

test("untradeable: listed companies are NOT refused — this list deletes ideas, so it must be tight", () => {
  for (const n of [
    "Enphase",
    "Oklo",
    "Alamos Gold",
    "Intel",
    "ServiceNow",
    "SolarEdge",
    "Carrier Global",
    "Advanced Micro Devices",
    "",
  ]) {
    assert.equal(isUntradeableSubject(n), false, `${n} must not be refused`);
  }
});

test("untradeable: every entry in the list is non-empty and folds to something", () => {
  for (const s of UNTRADEABLE_SUBJECTS) {
    assert.ok(foldName(s).length > 0, `${s} folds to nothing and would match everything`);
  }
});

// --- name agreement ---------------------------------------------------------

test("names agree: the same company written loosely still matches", () => {
  assert.equal(namesAgree("Enphase", "Enphase Energy, Inc."), true);
  assert.equal(namesAgree("Oklo", "Oklo Inc."), true);
  assert.equal(namesAgree("Alamos Gold", "Alamos Gold Inc."), true);
  assert.equal(namesAgree("Intel", "Intel Corporation"), true);
  assert.equal(namesAgree("ServiceNow", "ServiceNow, Inc."), true);
  assert.equal(namesAgree("B2Gold", "B2Gold Corp."), true);
  assert.equal(namesAgree("The Trade Desk", "The Trade Desk, Inc."), true);
  assert.equal(namesAgree("Unusual Machines", "Unusual Machines, Inc."), true);
});

test("names agree: a ticker recalled from memory is caught — the whole point", () => {
  // the reported failure, and a real one already in the book
  assert.equal(namesAgree("SpaceX", "Virgin Galactic Holdings, Inc."), false);
  assert.equal(namesAgree("Carrier Global", "Avis Budget Group, Inc."), false);
  assert.equal(namesAgree("Microsoft", "Apple Inc."), false);
});

test("names agree: an absent spoken name is never a disagreement", () => {
  // the speaker said only a ticker — there is nothing to contradict
  assert.equal(namesAgree("", "Apple Inc."), true);
  assert.equal(namesAgree("AAPL", ""), true);
  assert.equal(namesAgree("", ""), true);
});

test("names agree: an ETF whose name restates the index still matches", () => {
  assert.equal(namesAgree("S&P 500", "State Street SPDR S&P 500 ETF Trust"), true);
  assert.equal(namesAgree("Energy sector", "State Street Energy Select Sector SPDR ETF"), true);
});

test("names agree: spacing is not disagreement — the transcript writes compound names apart", () => {
  // all three were refused on a real run before this was fixed, deleting
  // three genuine ideas
  assert.equal(namesAgree("B2 Gold", "B2Gold Corp."), true);
  assert.equal(namesAgree("Solar Edge", "SolarEdge Technologies, Inc."), true);
  assert.equal(namesAgree("Service Now", "ServiceNow, Inc."), true);
  // and closing the gap must not start matching unrelated companies
  assert.equal(namesAgree("SpaceX", "Virgin Galactic Holdings, Inc."), false);
  assert.equal(namesAgree("Carrier Global", "Avis Budget Group, Inc."), false);
});
