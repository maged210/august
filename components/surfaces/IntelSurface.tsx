// Placeholder Intel surface — sources column, AUGUST synthesis, room for the globe.
const SOURCES = [
  { src: "REUTERS", head: "Talks resume as ceasefire holds for a second day" },
  { src: "BLOOMBERG", head: "Chip-demand outlook lifts Asian suppliers" },
  { src: "FT", head: "Central bank signals patience on rate cuts" },
  { src: "AP", head: "Storm system tracks toward the Gulf" },
  { src: "WIRES", head: "Shipping rates ease as port backlog clears" },
];

export default function IntelSurface() {
  return (
    <div className="surface intel-surface">
      <header className="surface-head">
        <h2 className="surface-title">Intel</h2>
        <span className="todo">TODO: live sources</span>
      </header>
      <div className="intel-grid">
        <section className="panel intel-feed">
          <div className="panel-head">Sources</div>
          <ul className="feed-list">
            {SOURCES.map((s, i) => (
              <li key={i}>
                <span className="feed-src">{s.src}</span>
                <span className="feed-head">{s.head}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel intel-synth">
          <div className="panel-head">AUGUST · Synthesis</div>
          <p className="synth-body">
            Three threads worth your attention today. I'll connect them into a single picture
            once I'm reading the wires — for now this is where that read will live.
          </p>
          <span className="todo">TODO: live synthesis</span>
        </section>

        <section className="panel intel-globe">
          <div className="panel-head">Globe</div>
          <p className="globe-hint">
            Ask me to <em>look closer</em> at any place — &ldquo;show me the Strait of Hormuz&rdquo; —
            and I&rsquo;ll open the globe over the deck and fly there.
          </p>
          <span className="todo">overlay active · data layers later</span>
        </section>
      </div>
    </div>
  );
}
