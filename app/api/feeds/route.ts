// The user's feed prefs + onboarded flag — the second per-user store, mirror
// of /api/watchlist (stage 3: the /welcome setup screen reads and writes it).
//
//   GET : { prefs, onboarded } — prefs fall back to the seed default
//         (gmail off, rss on, markets on) when absent; onboarded reports
//         whether this account has been through /welcome.
//   PUT : { prefs?, onboarded? } — prefs replaces the three toggles (strict:
//         exactly three booleans); onboarded: true marks setup as seen (Start
//         and Skip both send it). Either field alone is a valid update.
//
// Personal route: covered by the middleware matcher AND resolveUserOr401
// in-route (defense-in-depth). Unconfigured auth = single-user fallback → the
// legacy-shaped key (august:feeds), exactly like every other store.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import {
  ensureUserSeeded,
  getFeedPrefs,
  getOnboarded,
  resolveUserOr401,
  setFeedPrefs,
  setOnboarded,
} from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("feeds", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  // Idempotent backfill, as in /api/watchlist: accounts that signed in before
  // seeding shipped still get their defaults on first read.
  if (user.email) await ensureUserSeeded(user.email);

  const [prefs, onboarded] = await Promise.all([
    getFeedPrefs(user.email),
    getOnboarded(user.email),
  ]);
  return Response.json(
    { prefs, onboarded },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(req: Request): Promise<Response> {
  const rl = await checkRateLimit("feeds", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  let body: { prefs?: unknown; onboarded?: unknown };
  try {
    body = (await req.json()) as { prefs?: unknown; onboarded?: unknown };
  } catch {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  if (body?.prefs === undefined && body?.onboarded === undefined) {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  let prefs = null;
  if (body.prefs !== undefined) {
    const result = await setFeedPrefs(user.email, body.prefs);
    if (!result.ok) {
      const status =
        result.error === "invalid_prefs" ? 400 : result.error === "storage_unconfigured" ? 501 : 502;
      return Response.json(result, { status });
    }
    prefs = result.prefs;
  }

  // The flag only ever moves forward — there is no "un-onboard" (re-editing
  // is just visiting /welcome again). Best-effort by design.
  if (body.onboarded === true) await setOnboarded(user.email);

  return Response.json(
    { ok: true, ...(prefs ? { prefs } : {}), onboarded: body.onboarded === true || undefined },
    { headers: { "Cache-Control": "no-store" } },
  );
}
