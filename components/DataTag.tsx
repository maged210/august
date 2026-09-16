// DATA INTEGRITY TAG (COMMAND CENTER R1) — the one vocabulary for how fresh
// or real a market number is: LIVE / DELAYED / SIM / PROXY / UNAVAILABLE,
// plus CALC for deterministic reads. Spread from the StatusBar/option-ticket
// pattern to every surface. Simulated never dresses as live; meaningful
// absence says DATA UNAVAILABLE, never a bare dash.

export type DataTagKind = "live" | "delayed" | "sim" | "proxy" | "unavail" | "calc" | "stale";

const LABEL: Record<DataTagKind, string> = {
  live: "LIVE",
  delayed: "DELAYED",
  sim: "SIMULATED",
  proxy: "PROXY",
  unavail: "DATA UNAVAILABLE",
  calc: "CALCULATED",
  stale: "STALE",
};

/** feat/v4-1-terminal — the same vocabulary for a tag that must fit a small
 *  tile (the dock heatmap): tighter tracking, and DATA UNAVAILABLE drops its
 *  "DATA" prefix. Same kinds, same colours; only the fit changes. */
const COMPACT_LABEL: Partial<Record<DataTagKind, string>> = { unavail: "UNAVAILABLE" };

export default function DataTag({ kind, detail, title, compact = false }: {
  kind: DataTagKind;
  /** short suffix, e.g. "60s" or "as of 09:42 ET" */
  detail?: string;
  title?: string;
  /** tile-sized: tighter tracking, shortest label in the vocabulary */
  compact?: boolean;
}) {
  return (
    <span className={`dtag dtag-${kind}${compact ? " dtag-compact" : ""}`} title={title}>
      {compact ? COMPACT_LABEL[kind] ?? LABEL[kind] : LABEL[kind]}
      {detail ? <i>{detail}</i> : null}
    </span>
  );
}
