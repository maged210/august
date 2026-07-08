"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

// The DESK slide — hosts the market dashboard without making the deck pay for
// it upfront. Two layers of laziness:
//   1. The dashboard bundle (charts, options workspace, its stylesheet) loads
//      via next/dynamic (ssr:false) — none of it is in the orb page's JS.
//   2. Nothing even *starts* loading until the desk slide first approaches the
//      viewport (IntersectionObserver on the slide root). Once live it stays
//      mounted, so tab state / feeds survive swiping away and back.
const IntelDashboard = dynamic(() => import("@/components/intel/IntelDashboard"), {
  ssr: false,
  loading: () => <DeskBoot connecting />,
});

// Terminal-style placeholder — styled from globals.css (the dashboard's own
// stylesheet ships with its chunk, so this can't depend on it).
function DeskBoot({ connecting }: { connecting?: boolean }) {
  return (
    <div className="desk-boot" aria-hidden>
      <div className="desk-boot-title">DESK</div>
      <div className="desk-boot-line">{connecting ? "CONNECTING TO FEEDS…" : "STANDBY"}</div>
      <div className="desk-boot-row" style={{ width: "52%" }} />
      <div className="desk-boot-row" style={{ width: "78%" }} />
      <div className="desk-boot-row" style={{ width: "64%" }} />
      <div className="desk-boot-row" style={{ width: "40%" }} />
    </div>
  );
}

export default function DeskSurface() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState(false);

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
    <div ref={rootRef} className="desk-slide">
      {live ? <IntelDashboard /> : <DeskBoot />}
    </div>
  );
}
