// Placeholder Comms surface — inbox rendered as terminal log lines. No real
// email / OAuth yet, just the look.
const MSGS = [
  { from: "viv", subj: "rehearsal moved to 7 — come if you can", t: "08:12", tag: "personal" },
  { from: "ops@firm", subj: "EOD risk report attached", t: "07:55", tag: "work" },
  { from: "no-reply", subj: "your statement is ready", t: "06:30", tag: "noise" },
  { from: "cleo (via viv)", subj: "a drawing for your desk", t: "y'day", tag: "personal" },
  { from: "calendar", subj: "invite: strategy sync, 15:00", t: "y'day", tag: "work" },
];

export default function CommsSurface() {
  return (
    <div className="surface comms-surface">
      <header className="surface-head">
        <h2 className="surface-title">Comms</h2>
        <span className="todo">TODO: live email · no auth yet</span>
      </header>
      <section className="panel comms-log">
        <div className="panel-head">Inbox — rendered as log</div>
        <ul className="loglines">
          {MSGS.map((m, i) => (
            <li key={i} className={`logline ${m.tag}`}>
              <span className="log-t">{m.t}</span>
              <span className="log-arrow">›</span>
              <span className="log-from">{m.from}</span>
              <span className="log-subj">{m.subj}</span>
              <span className="log-tag">{m.tag}</span>
            </li>
          ))}
        </ul>
        <div className="comms-foot">$ augustctl mailbox --tail · 5 shown · placeholder</div>
      </section>
    </div>
  );
}
