// AUTH-1a B1 — the anonymous-surface contract. This suite failing blocks
// every future gate: auth is ADDITIVE, nothing in AUTH-1a may lock content.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ANONYMOUS_SURFACE, GATED, isGated } from "../lib/route-gates";
import { deriveChatPrincipal } from "../lib/user-scope";

test("B1: the anonymous principal surface is NEVER session-gated", () => {
  for (const open of ANONYMOUS_SURFACE) {
    assert.equal(isGated(open), false, `${open} must not be gated`);
    assert.ok(!GATED.some((g) => open === g || open.startsWith(g + "/")), `${open} shadowed by GATED`);
  }
  // the personal/spend surfaces stay gated
  for (const g of ["/api/day", "/api/comms/send", "/api/brief", "/api/speak"]) {
    assert.equal(isGated(g), true, `${g} must stay gated`);
  }
});

test("B1: configured auth + no session ⇒ anonymous visitor principal, minted never refused", () => {
  // fresh origin, no cookie: the decision is a visitor with a to-be-minted vid
  assert.deepEqual(
    deriveChatPrincipal({ configured: true, email: null, production: true, cookieVid: null }),
    { kind: "visitor", vid: null },
  );
  // returning anonymous visitor keeps their id
  assert.deepEqual(
    deriveChatPrincipal({ configured: true, email: null, production: true, cookieVid: "abc-123-def" }),
    { kind: "visitor", vid: "abc-123-def" },
  );
  // a session upgrades the principal — and that is ALL it does
  assert.deepEqual(
    deriveChatPrincipal({ configured: true, email: "a@b.c", production: true, cookieVid: "abc-123-def" }),
    { kind: "user", email: "a@b.c" },
  );
});
