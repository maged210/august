import { getBrief } from "@/lib/brief";

// AUGUST's opening brief, shown on Presence. One synthesis line per surface.
// Lines come from getBrief() (stubbed) — live per-surface data drops in there.
export default function Brief({ visible }: { visible: boolean }) {
  const lines = getBrief();
  return (
    <div className={`brief${visible ? " brief-in" : ""}`} aria-hidden={!visible}>
      <div className="brief-head">THE BRIEF</div>
      <ul className="brief-lines">
        {lines.map((l) => (
          <li key={l.surface} className="brief-line">
            <span className="brief-surface">{l.label}</span>
            <span className="brief-text">{l.line}</span>
            {l.stub ? <span className="brief-todo">live soon</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
