"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GlobeTarget } from "@/components/command/CommandGlobe";

// The WORLD slide — hosts the MapLibre globe without making the deck pay for it
// upfront. Same two layers of laziness as DeskSurface:
//   1. The globe bundle (maplibre-gl, its stylesheet, the intel panel) loads via
//      next/dynamic (ssr:false) — none of it is in the orb page's initial JS.
//   2. Nothing even *starts* loading until the World slide first approaches the
//      viewport (IntersectionObserver on the slide root) — or until AUGUST's
//      look_closer tool targets the globe / the deck lands here, either of which
//      must always summon it. Once live it stays mounted, so the map, camera and
//      layer state survive swiping away and back.
const CommandGlobe = dynamic(() => import("@/components/command/CommandGlobe"), {
  ssr: false,
  loading: () => <WorldBoot connecting />,
});

// Terminal-style placeholder — reuses the desk's boot styling (globals.css),
// which renders before any lazily-loaded chunk exists.
function WorldBoot({ connecting }: { connecting?: boolean }) {
  return (
    <div className="desk-boot" aria-hidden>
      <div className="desk-boot-title">WORLD</div>
      <div className="desk-boot-line">{connecting ? "ACQUIRING GLOBE…" : "STANDBY"}</div>
      <div className="desk-boot-row" style={{ width: "58%" }} />
      <div className="desk-boot-row" style={{ width: "74%" }} />
      <div className="desk-boot-row" style={{ width: "46%" }} />
    </div>
  );
}

type Props = {
  active: boolean; // is World the current deck surface?
  flyTo: GlobeTarget | null;
};

export default function WorldSurface({ active, flyTo }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState(false);

  // A fly-to target (AUGUST's look_closer sets it in the same tick it starts the
  // deck slide) or an arrival on the slide must always summon the globe, even if
  // the observer hasn't fired yet — a flight may never be dropped. CommandGlobe
  // replays the pending target once the map loads, so this ordering holds:
  // deck slides → globe mounts/resumes → flyTo runs.
  const summon = active || flyTo != null;
  useEffect(() => {
    if (summon) setLive(true);
  }, [summon]);

  useEffect(() => {
    if (live) return;
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setLive(true); // ancient browser — just load it
      return;
    }
    // rootMargin extends the viewport, so this fires while the slide is still
    // approaching (mid-swipe / mid-goTo), not only once it has fully arrived.
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setLive(true)),
      { rootMargin: "25%" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [live]);

  return (
    <div ref={rootRef} className="world-slide">
      {live ? <CommandGlobe active={active} flyTo={flyTo} /> : <WorldBoot />}
    </div>
  );
}
