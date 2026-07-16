"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { IBM_Plex_Mono, Hanken_Grotesk } from "next/font/google";
import "@/app/intel/tokens.css";
import "@/app/intel/intel.css";

// The deck's second surface is AUDIENCE-AWARE:
//   owner on a >700px viewport → the full /intel desk, embedded (unchanged);
//   everyone else — any non-owner, or ANY viewer ≤700px — → the public IDEAS
//   feed (owner-published, server-redacted cards). The owner on a phone gets
//   an OPEN DESK → link to /intel inside the feed header instead of the desk.
// Both bodies are dynamic chunks behind the same lazy-mount latch — nothing
// intel-sized rides the home bundle for users who stay on Presence, and the
// desk dashboard never mounts at all when the feed branch is taken.
const IntelDashboard = dynamic(() => import("@/components/intel/IntelDashboard"), {
  loading: () => <IdleStage />,
});
const IdeasFeed = dynamic(() => import("@/components/surfaces/IdeasFeed"), {
  loading: () => <IdleStage />,
});

// Same font config as app/intel/page.tsx — two next/font instances of the
// same font dedupe at build time; the variables land on the embedded
// .intel-root only, so the home shell keeps --font-mono/--font-sans.
const rdMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--rd-font-mono",
  display: "swap",
});
const rdSans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--rd-font-sans",
  display: "swap",
});

// Pre-visit placeholder: the intel stage color + a mono label. No fake data,
// no spinner — the real body (and its fetch loops) mounts on first visit.
function IdleStage() {
  return (
    <div className="intel-embed-idle">
      <span>MARKET INTEL</span>
    </div>
  );
}

export default function IntelDeckSurface({ active }: { active: boolean }) {
  // Lazy-mount latch: neither body's fetch loops may run for users sitting on
  // Presence. Once visited, it STAYS mounted so tab/selection/quote state
  // survives panel switches. Render-phase setState is the documented "derive
  // state from props" latch — no effect needed.
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);

  // Audience signals — both start unknown so the first paint is the idle
  // stage on server and client alike (no hydration seam).
  //   owner:  GET /api/intel/role once per mount, only after first visit; a
  //           fetch failure honestly degrades to the public feed.
  //   narrow: matchMedia at the 700px boundary — this JS check must stay in
  //           lockstep with the repo's <700px CSS convention (same contract
  //           as the 760px comment in components/command/IntelPanel.tsx:20-24:
  //           no styled-but-wrong-surface seam).
  const [owner, setOwner] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState<boolean | null>(null);

  useEffect(() => {
    if (!visited) return;
    let cancelled = false;
    fetch("/api/intel/role", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("role_unavailable"))))
      .then((j: { owner?: boolean } | null) => {
        if (!cancelled) setOwner(j?.owner === true);
      })
      .catch(() => {
        if (!cancelled) setOwner(false); // role unknown → treat as non-owner
      });
    return () => {
      cancelled = true;
    };
  }, [visited]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const mode: "idle" | "desk" | "feed" =
    !visited || owner === null || narrow === null ? "idle" : owner && !narrow ? "desk" : "feed";

  return (
    // The frame's transform makes it the containing block for the embed's
    // position:fixed layers (desk askbar, video drawer + scrim; feed bottom
    // sheet + scrim) — nothing inside can escape over Presence/World/Comms
    // or the home chrome.
    <div className="intel-embed-frame">
      {mode === "feed" ? (
        // The public feed rides the same .intel-root.intel-embedded contracts
        // as the desk (internal scroll, token scope, light-theme re-pins, the
        // body-scroll :has() guard) — only the body differs. `cinematic` is a
        // desk-only illumination gate and stays off here.
        <div className={`intel-root intel-embedded ${rdMono.variable} ${rdSans.variable}`}>
          <IdeasFeed showDeskLink={owner === true} />
        </div>
      ) : (
        <div className={`intel-root cinematic intel-embedded ${rdMono.variable} ${rdSans.variable}`}>
          {mode === "desk" ? <IntelDashboard /> : <IdleStage />}
        </div>
      )}
    </div>
  );
}
