// THE PUBLIC WIRE'S FAILURE VOCABULARY (fix/route-failure-honesty).
// DESIGN_LAWS L11 — a failed read and an empty one are different answers.
//
// These tests pin the contract itself and, critically, the CONSUMER's decision:
// a 200 response whose body says ok:false must reach the same "unavailable"
// state as a dead socket. That is the case the old code could not see, because
// it only ever branched on the transport.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  causeOf,
  degradedLine,
  listSurfaceState,
  readWire,
  wireBody,
  wireDown,
  wireOk,
  WIRE_DOWN_STATUS,
  type SourceFailure,
} from "../lib/wire.ts";

// --- the route half ---------------------------------------------------------

test("L11 wire: a failed read answers 503 with its cause — never an empty ok", () => {
  const { body, status } = wireBody(wireDown<number>("Upstash refused the connection"), "ideas");
  assert.equal(status, WIRE_DOWN_STATUS);
  assert.equal(body.ok, false);
  assert.equal(body.error, "Upstash refused the connection");
  // THE REGRESSION THIS PINS: the rows key must be ABSENT on a failure. A
  // consumer that reads `ideas` off a failure body and finds [] is back where
  // this branch started.
  assert.equal("ideas" in body, false, "a failure carries no row key at all");
  assert.equal("degraded" in body, false);
});

test("L11 wire: an empty-but-healthy read is a 200 success, not a failure", () => {
  const { body, status } = wireBody(wireOk<number>([]), "ideas", { disclaimer: "d" });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.ideas, []);
  assert.equal(body.disclaimer, "d", "extras ride success");
  // no degraded key when nothing failed — its PRESENCE is the partial signal
  assert.equal("degraded" in body, false);
});

test("L11 wire: a partial read serves what lives AND names what didn't answer", () => {
  const failed: SourceFailure[] = [
    { source: "BBC", reason: "403" },
    { source: "AP", reason: "timed out" },
  ];
  const { body, status } = wireBody(wireOk([1, 2], failed), "headlines");
  assert.equal(status, 200, "rows exist, so the answer is a success");
  assert.equal(body.ok, true);
  assert.deepEqual(body.headlines, [1, 2]);
  assert.deepEqual(body.degraded, failed, "the dead sources are named, not dropped");
});

test("L11 wire: a cause is never empty, whatever was thrown", () => {
  assert.equal(causeOf(new Error("ECONNREFUSED")), "ECONNREFUSED");
  assert.equal(causeOf("boom"), "boom");
  assert.equal(causeOf(new Error("   ")), "the source didn't answer");
  assert.equal(causeOf(null), "the source didn't answer");
  assert.equal(causeOf({}), "the source didn't answer", "[object Object] is not a cause");
  assert.equal(causeOf(undefined, "custom"), "custom");
  // wireDown refuses to carry an empty reason too
  const down = wireDown<number>("   ");
  assert.equal(down.state === "unavailable" && down.reason, "the source didn't answer");
});

// --- the consumer half ------------------------------------------------------

test("L11 consumer: a 200 whose body says ok:false renders UNAVAILABLE, not empty", () => {
  // THE CASE THE OLD CODE COULD NOT SEE. Transport fine, status fine, and the
  // desk is telling you it cannot see its own book. Before this branch the
  // consumer read `ideas` off the body, found nothing, and rendered "0 live
  // calls" — a false claim about the desk's record.
  const read = readWire<number>({ ok: true, status: 200 }, { ok: false, error: "Upstash is down" }, "ideas");
  assert.equal(read.state, "unavailable");
  assert.equal(read.state === "unavailable" && read.reason, "Upstash is down");
});

test("L11 consumer: 503, a dead socket and an unreadable body all reach one state", () => {
  const byStatus = readWire<number>({ ok: false, status: 503 }, { ok: false, error: "Upstash is down" }, "ideas");
  assert.equal(byStatus.state, "unavailable");
  assert.equal(byStatus.state === "unavailable" && byStatus.reason, "Upstash is down");

  // fetch() itself threw — no response at all
  const thrown = readWire<number>(null, null, "ideas");
  assert.equal(thrown.state, "unavailable");
  assert.ok(
    thrown.state === "unavailable" && thrown.reason.length > 0,
    "an unreachable desk still states something",
  );

  // a 500 with an unparsable body: still a failure, still not empty
  const garbled = readWire<number>({ ok: false, status: 500 }, "<html>502 Bad Gateway</html>", "ideas");
  assert.equal(garbled.state, "unavailable");
  assert.ok(garbled.state === "unavailable" && garbled.reason.includes("500"));

  // a 200 whose body is not the shape we asked for is NOT silently empty
  const wrongShape = readWire<number>({ ok: true, status: 200 }, { nope: 1 }, "ideas");
  assert.equal(wrongShape.state, "unavailable");
});

test("L11 consumer: zero rows on a healthy read stays a success", () => {
  const read = readWire<number>({ ok: true, status: 200 }, { ok: true, ideas: [] }, "ideas");
  assert.equal(read.state, "ok");
  assert.deepEqual(read.state === "ok" && read.rows, []);
  assert.deepEqual(read.state === "ok" && read.failed, []);
  // and a missing row key on a success body reads as zero rows, not a failure
  const noKey = readWire<number>({ ok: true, status: 200 }, { ok: true }, "ideas");
  assert.equal(noKey.state, "ok");
  assert.deepEqual(noKey.state === "ok" && noKey.rows, []);
});

test("L11 consumer: a partial read keeps its rows and carries the dead sources", () => {
  const read = readWire<number>(
    { ok: true, status: 200 },
    { ok: true, headlines: [1, 2], degraded: [{ source: "BBC", reason: "403" }] },
    "headlines",
  );
  assert.equal(read.state, "ok");
  assert.deepEqual(read.state === "ok" && read.rows, [1, 2]);
  assert.deepEqual(read.state === "ok" && read.failed, [{ source: "BBC", reason: "403" }]);
  // junk in `degraded` is dropped rather than rendered — a nameless source
  // cannot be named to a reader
  const junk = readWire<number>(
    { ok: true, status: 200 },
    { ok: true, headlines: [1], degraded: [{ reason: "x" }, "nope", { source: "  " }, { source: "AP" }] },
    "headlines",
  );
  assert.deepEqual(junk.state === "ok" && junk.failed, [{ source: "AP", reason: "" }]);
});

test("L11 consumer: degradedLine names the missing sources, or says nothing at all", () => {
  assert.equal(degradedLine([]), null, "a complete list makes no claim about failure");
  assert.equal(
    degradedLine([{ source: "BBC", reason: "403" }]),
    "BBC didn't answer — this list is missing what they carry.",
  );
  assert.equal(
    degradedLine([
      { source: "BBC", reason: "" },
      { source: "AP", reason: "" },
      { source: "Guardian", reason: "" },
    ]),
    "BBC, AP and Guardian didn't answer — this list is missing what they carry.",
  );
  // the same source failing twice is named once
  assert.equal(
    degradedLine([
      { source: "AP", reason: "403" },
      { source: "AP", reason: "timeout" },
    ]),
    "AP didn't answer — this list is missing what they carry.",
  );
});

// --- the surface decision ---------------------------------------------------
// The terminal derives its EMPTY / UNREACHABLE states from this. Before it
// existed, each surface derived them by hand and they drifted.

test("L11 surface: EMPTY claims the desk published nothing — only the LATEST read may say it", () => {
  // first load, nothing back yet
  assert.equal(listSurfaceState({ answered: false, failed: false, rows: 0 }), "loading");
  // the book answered and is genuinely empty — a real claim, honestly made
  assert.equal(listSurfaceState({ answered: true, failed: false, rows: 0 }), "empty");

  // THE REGRESSION THIS PINS: the book answered empty at 09:00 and the store
  // died at 09:01. `answered` is still true — a poll landed once — but the
  // LATEST read failed, so the surface must not keep stating that the desk has
  // published nothing. It was this exact combination that kept rendering
  // "NO IDEAS ON THE BOARD" through an outage.
  assert.equal(listSurfaceState({ answered: true, failed: true, rows: 0 }), "unreachable");

  // and a first poll that fails outright
  assert.equal(listSurfaceState({ answered: false, failed: true, rows: 0 }), "unreachable");
});

test("L11 surface: rows already in hand outlive a failed poll — sticky-live, never blanked", () => {
  assert.equal(listSurfaceState({ answered: true, failed: false, rows: 5 }), "rows");
  // a refresh blip must not blank a board that is holding real rows; the
  // chip says the read failed, the rows stay readable
  assert.equal(listSurfaceState({ answered: true, failed: true, rows: 5 }), "rows");
});
