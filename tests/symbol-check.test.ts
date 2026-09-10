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
  compareNames,
  editDistanceWithin,
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

// --- three states, not two --------------------------------------------------
// "unknown" must never collapse into "agree": Yahoo answers indices and
// futures with NO name, and treating an unanswerable question as a pass is how
// a wrong ticker gets stamped confirmed.

test("compare: a resolved name we cannot read is UNKNOWN, not agreement", () => {
  // SPX / NQ / VIX come back from Yahoo with no longName and no shortName
  assert.equal(compareNames("Nasdaq 100", ""), "unknown");
  assert.equal(compareNames("", ""), "unknown");
});

test("compare: the speaker naming no company is the one true non-question", () => {
  // nothing was claimed, so there is nothing to contradict — flagging every
  // ticker-only mention would refill the queue this work exists to empty
  assert.equal(compareNames("", "Apple Inc."), "agree");
});

test("compare: agreement and disagreement still read normally", () => {
  assert.equal(compareNames("Enphase", "Enphase Energy, Inc."), "agree");
  assert.equal(compareNames("SpaceX", "Virgin Galactic Holdings, Inc."), "disagree");
  assert.equal(compareNames("S&P 500", "State Street SPDR S&P 500 ETF Trust"), "agree");
});

test("names agree: with the shared-word rule gone, a loose colloquial name no longer passes", () => {
  // the cost of dropping the rule, accepted deliberately: this now FLAGS for a
  // human instead of silently passing. It is not deleted.
  assert.equal(namesAgree("Energy sector", "State Street Energy Select Sector SPDR ETF"), false);
  assert.equal(namesAgree("Google", "Alphabet Inc."), false);
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

// --- the dock lane uses the SAME gate ---------------------------------------
// A wrong ticker publishes the wrong security whether it arrives as an idea or
// as a tape callout, so tape must not get a weaker check.

test("tape lane: the same refusals and the same generosity apply", () => {
  // untradeable subject, refused by name before any lookup
  assert.equal(isUntradeableSubject("SpaceX"), true);
  // a ticker recalled from memory is caught by name disagreement
  assert.equal(namesAgree("SpaceX", "Virgin Galactic Holdings, Inc."), false);
  assert.equal(namesAgree("Carrier Global", "Avis Budget Group, Inc."), false);
  // and spacing is still not disagreement on this lane either
  assert.equal(namesAgree("Solar Edge", "SolarEdge Technologies, Inc."), true);
  // a bare underlying with no spoken company is never flagged on name
  assert.equal(compareNames("", "State Street SPDR S&P 500 ETF Trust"), "agree");
});

// --- the shared-word rule is GONE -------------------------------------------
// It accepted a single common token as agreement and passed exactly the
// substitutions this gate exists to catch.

test("no shared-word rule: one common word is not agreement any more", () => {
  assert.equal(namesAgree("Micron Technology", "Marvell Technology, Inc."), false);
  assert.equal(namesAgree("American Airlines", "American Express Company"), false);
  assert.equal(namesAgree("Marathon Digital", "Marathon Petroleum Corporation"), false);
  assert.equal(namesAgree("General Motors", "General Dynamics Corporation"), false);
});

// --- the refusal list is matched RAW ----------------------------------------

test("untradeable list: folding it turned 'x corp' into a one-letter wildcard", () => {
  // this refused the whole Global X ETF family as private companies
  assert.equal(isUntradeableSubject("Global X Uranium ETF"), false);
  assert.equal(isUntradeableSubject("Global X Lithium & Battery Tech ETF"), false);
  assert.equal(isUntradeableSubject("X Financial"), false);
  assert.equal(isUntradeableSubject("United States Steel"), false);
  // while the real entries still refuse
  assert.equal(isUntradeableSubject("X Corp"), true);
  assert.equal(isUntradeableSubject("SpaceX"), true);
});

// --- mis-heard names --------------------------------------------------------

test("names agree: a mis-transcribed name is tolerated — 'Oaklo' is Oklo", () => {
  // a real run refused OKLO on the dock lane because the transcript spelled
  // it "Oaklo"; the ticker was right and the row was deleted for a typo
  assert.equal(namesAgree("Oaklo", "Oklo Inc."), true);
  assert.equal(namesAgree("Nphase", "Enphase Energy, Inc."), true);
});

test("names agree: tolerance stays tight — different companies still disagree", () => {
  assert.equal(namesAgree("SpaceX", "Virgin Galactic Holdings, Inc."), false);
  assert.equal(namesAgree("Carrier Global", "Avis Budget Group, Inc."), false);
  assert.equal(namesAgree("Microsoft", "Apple Inc."), false);
  assert.equal(namesAgree("Alphabet", "Alphatec Holdings, Inc."), false);
  assert.equal(namesAgree("Lumentum", "Lucid Group, Inc."), false);
});

test("editDistanceWithin: exact, near, and far", () => {
  assert.equal(editDistanceWithin("oklo", "oaklo", 1), true);
  assert.equal(editDistanceWithin("oklo", "oklo", 0), true);
  assert.equal(editDistanceWithin("apple", "microsoft", 2), false);
  // the length guard short-circuits before any work
  assert.equal(editDistanceWithin("a", "abcdefgh", 2), false);
});

test("KNOWN LIMIT: a wrong company whose name BEGINS with the spoken one still passes", () => {
  // pinned deliberately so the hole is visible rather than assumed closed.
  // "Apple" inside "Apple Hospitality REIT" is structurally identical to
  // "Enphase" inside "Enphase Energy" — containment cannot separate them.
  assert.equal(namesAgree("Apple", "Apple Hospitality REIT, Inc."), true); // wrong, and known
  assert.equal(namesAgree("Enphase", "Enphase Energy, Inc."), true); // right
});
