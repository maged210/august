"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { IBM_Plex_Mono, Hanken_Grotesk } from "next/font/google";
import "@/app/intel/tokens.css";
import "@/app/intel/intel.css";

// The full /intel desk, embedded as the deck's second surface (user decision:
// intel replaces the Markets page in the home deck; /intel remains for deep
// links + the mobile PWA). The dashboard chunk loads only on first visit —
// nothing intel-sized rides the home bundle for users who stay on Presence.
const IntelDashboard = dynamic(() => import("@/components/intel/IntelDashboard"), {
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
// no spinner — the real dashboard (and its fetch loops) mounts on first visit.
function IdleStage() {
  return (
    <div className="intel-embed-idle">
      <span>MARKET INTEL</span>
    </div>
  );
}

export default function IntelDeckSurface({ active }: { active: boolean }) {
  // Lazy-mount latch: the dashboard's fetch loops must not run for users
  // sitting on Presence. Once visited, it STAYS mounted so tab/selection/
  // quote state survives panel switches. Render-phase setState is the
  // documented "derive state from props" latch — no effect needed.
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);

  return (
    // The frame's transform makes it the containing block for the desk's
    // position:fixed layers (askbar, video drawer + scrim) — nothing inside
    // the embed can escape over Presence/World/Comms or the home chrome.
    <div className="intel-embed-frame">
      <div className={`intel-root cinematic intel-embedded ${rdMono.variable} ${rdSans.variable}`}>
        {visited ? <IntelDashboard /> : <IdleStage />}
      </div>
    </div>
  );
}
