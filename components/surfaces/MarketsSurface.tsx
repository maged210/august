// Placeholder Markets surface — styled, sample values, no live data yet.
const WATCH = [
  { sym: "ES", desc: "S&P 500", last: "5,432.25", chg: "+0.32%" },
  { sym: "NQ", desc: "Nasdaq 100", last: "19,210.50", chg: "+0.54%" },
  { sym: "YM", desc: "Dow", last: "40,118", chg: "+0.11%" },
  { sym: "CL", desc: "Crude", last: "78.40", chg: "-0.88%" },
  { sym: "GC", desc: "Gold", last: "2,402.10", chg: "+0.21%" },
  { sym: "BTC", desc: "Bitcoin", last: "67,840", chg: "+1.42%" },
];
const LEVELS = [
  { k: "Resistance", v: "19,320" },
  { k: "Pivot", v: "19,180" },
  { k: "Support", v: "19,040" },
  { k: "O/N High", v: "19,260" },
  { k: "O/N Low", v: "19,090" },
];
const ECON = [
  { t: "08:30", e: "Initial Jobless Claims", i: "med" },
  { t: "10:00", e: "Existing Home Sales", i: "low" },
  { t: "13:00", e: "30Y Bond Auction", i: "med" },
  { t: "—", e: "Fed speakers (2)", i: "low" },
];

export default function MarketsSurface() {
  return (
    <div className="surface markets-surface">
      <header className="surface-head">
        <h2 className="surface-title">Markets</h2>
        <span className="todo">TODO: live data</span>
      </header>
      <div className="markets-grid">
        <section className="panel">
          <div className="panel-head">Watchlist</div>
          <table className="term-table">
            <tbody>
              {WATCH.map((w) => (
                <tr key={w.sym}>
                  <td className="t-sym">{w.sym}</td>
                  <td className="t-desc">{w.desc}</td>
                  <td className="t-last">{w.last}</td>
                  <td className={`t-chg ${w.chg.startsWith("-") ? "neg" : "pos"}`}>{w.chg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-head">NQ · Levels</div>
          <div className="nq-price">
            19,210.50 <span className="pos">+0.54%</span>
          </div>
          <ul className="kv-list">
            {LEVELS.map((l) => (
              <li key={l.k}>
                <span>{l.k}</span>
                <span>{l.v}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-head">Economic Calendar</div>
          <ul className="econ-list">
            {ECON.map((e, i) => (
              <li key={i}>
                <span className="econ-t">{e.t}</span>
                <span className="econ-e">{e.e}</span>
                <span className={`econ-i ${e.i}`}>{e.i}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
