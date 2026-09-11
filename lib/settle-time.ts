// THE SETTLE TIME — derived from the real cron, never restated.
//
// Six user-visible strings used to hardcode "22:10 UTC" (the idea board
// header, two IdeasFeed group labels, the desk blotter caption). Six copies of
// a schedule is five too many: move the cron in vercel.json and the UI keeps
// announcing the old time, confidently and wrongly.
//
// SHAPE: this file is PURE and testable (node:test cannot import JSON without
// an import attribute the bundler does not use). The one JSON read lives in
// lib/settle-cron.ts, which the app imports; the test reads vercel.json off
// disk and asserts the label this file derives matches the real schedule. So
// the binding is enforced, not just intended.

/** the route whose schedule settles THE CALL and runs the daily pass */
export const SETTLE_ROUTE = "/api/cron/intel-track";

/** PURE. "10 22 * * *" → { hour: 22, minute: 10 }. null when the expression is
 *  not a plain daily HH:MM — this never guesses at a schedule it cannot read,
 *  because a wrong time stated confidently is worse than no time. */
export function parseDailyCron(expr: string): { hour: number; minute: number } | null {
  const parts = (expr ?? "").trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [min, hr, dom, mon, dow] = parts;
  // anything but a fixed daily time is not a time we can name
  if (!/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hr)) return null;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;
  const minute = Number(min);
  const hour = Number(hr);
  if (minute > 59 || hour > 23) return null;
  return { hour, minute };
}

/** PURE. The label every surface shows. Falls back to naming the pass rather
 *  than inventing a time when the schedule cannot be parsed. */
export function settleLabel(schedule: string | null | undefined): string {
  const p = schedule ? parseDailyCron(schedule) : null;
  if (!p) return "the daily pass";
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(p.hour)}:${two(p.minute)} UTC`;
}
