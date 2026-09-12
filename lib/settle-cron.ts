// The ONE read of vercel.json. Split from lib/settle-time so the parsing stays
// testable under node:test (which cannot import JSON without an attribute the
// bundler does not use) while the app still DERIVES its label from the real
// schedule rather than restating it.

import vercel from "@/vercel.json";
import { SETTLE_ROUTE, settleLabel } from "@/lib/settle-time";

type Cron = { path: string; schedule: string };

const schedule =
  ((vercel as { crons?: Cron[] }).crons ?? []).find((c) => c.path === SETTLE_ROUTE)?.schedule ?? null;

/** "22:10 UTC", or "the daily pass" when the schedule is not a fixed daily time */
export const SETTLE_UTC_LABEL = settleLabel(schedule);
