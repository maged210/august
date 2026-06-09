"use client";

import { useEffect, useState } from "react";
import { getBrief } from "@/lib/brief";

// AUGUST's opening brief, shown on Presence. One synthesis line per surface.
// Markets and Command lines are LIVE; the others are stubs until their surfaces
// are wired.
export default function Brief({ visible }: { visible: boolean }) {
  const base = getBrief();
  const [live, setLive] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const pull = (surface: string, url: string) =>
      fetch(url, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (alive && typeof j?.briefLine === "string") {
            setLive((prev) => ({ ...prev, [surface]: j.briefLine }));
          }
        })
        .catch(() => {});
    const load = () => {
      pull("markets", "/api/markets");
      pull("command", "/api/command");
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const lines = base.map((l) =>
    live[l.surface] ? { ...l, line: live[l.surface], stub: false } : l,
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
