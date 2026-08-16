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

export default function DataTag({ kind, detail, title }: {
  kind: DataTagKind;
  /** short suffix, e.g. "60s" or "as of 09:42 ET" */
  detail?: string;
  title?: string;
}) {
  return (
    <span className={`dtag dtag-${kind}`} title={title}>
      {LABEL[kind]}
      {detail ? <i>{detail}</i> : null}
    </span>
  );
}
