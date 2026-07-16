// Collapse math for the desk's ONE "SHOW MORE · n MORE" primitive (RdMore in
// components/intel/IntelDashboard.tsx). Pure and presentation-only: nothing
// here knows what an idea is, and nothing here may ever change what data
// exists — only how much of it is on screen at once. Section header counts
// keep reporting the TRUE total everywhere; a cap must never make the page lie
// about how much there is.
//
// The one rule worth a unit test: a control that hides almost nothing is
// noise. "SHOW MORE · 1 MORE" costs a row of chrome to save a row of content,
// so a trivial overflow renders whole with no control at all. The same rule in
// two units — items (COUNT mode) and pixels (HEIGHT mode).

/** the smallest COUNT overflow that earns a control — 1 hidden item never does */
export const COLLAPSE_MIN_HIDDEN = 2;

/** the smallest HEIGHT overflow that earns a control, px — roughly one line of
 * the desk's 11–12.5px prose at 1.45–1.5 line-height, plus the fade's own bite.
 * Below this the clamp would cost more chrome than it saves. */
export const COLLAPSE_MIN_HIDDEN_PX = 28;

export type CapPlan = {
  /** how many items to render right now */
  shown: number;
  /** how many the COLLAPSED control reports as hidden — the REAL number, always
   * `total - cap` (0 when no control is warranted) */
  hidden: number;
  /** whether a SHOW MORE / SHOW LESS control is warranted at all */
  control: boolean;
};

/** COUNT mode: how much of a `total`-item list to render at `cap`.
 * `hidden` is the exact count the control names — never rounded, never a
 * guess. A trivial overflow (< COLLAPSE_MIN_HIDDEN) renders whole. */
export function capPlan(total: number, cap: number, expanded: boolean): CapPlan {
  const over = total - cap;
  if (cap <= 0 || over < COLLAPSE_MIN_HIDDEN) return { shown: total, hidden: 0, control: false };
  return { shown: expanded ? total : cap, hidden: over, control: true };
}

/** HEIGHT mode: whether clamping `contentPx` to `capPx` hides enough to be
 * worth a control. `contentPx` is null until the block has been measured —
 * unmeasured content is assumed to overflow (the clamp is applied from the
 * first paint, so releasing it after measurement never flashes full content). */
export function heightOverflows(contentPx: number | null, capPx: number): boolean {
  if (contentPx === null) return true;
  return contentPx - capPx >= COLLAPSE_MIN_HIDDEN_PX;
}
