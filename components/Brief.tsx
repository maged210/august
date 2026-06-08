"use client";

import { useEffect, useState } from "react";
import { getBrief } from "@/lib/brief";

// AUGUST's opening brief, shown on Presence. One synthesis line per surface.
// The Markets line is LIVE (from /api/markets); the others are stubs until their
// surfaces are wired.
export default function Brief({ visible }: { visible: boolean }) {
  const base = getBrief();
  const [marketsLine, setMarketsLine] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/markets", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (alive && typeof j?.briefLine === "string") setMarketsLine(j.briefLine);
        })
        .catch(() => {});
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const lines = base.map((l) =>
    l.surface === "markets" && marketsLine ? { ...l, line: marketsLine, stub: false } : l,
  );

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
