"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { IBM_Plex_Mono, Hanken_Grotesk } from "next/font/google";
import "@/app/intel/frame.css";

// THE TERMINAL (chore/terminal-cut) — ONE body for every role: the public
// ideas feed. The July owner desk (IntelDashboard, OptionsWorkspace, the
// brief pipeline) is retired; the only owner difference on this surface is
// the ADMIN chip IdeasFeed renders through useOwner. The body is a dynamic
// chunk behind a lazy-mount latch — nothing terminal-sized rides the home
// bundle for users who stay on the floor.
const IdeasFeed = dynamic(() => import("@/components/surfaces/IdeasFeed"), {
  loading: () => <IdleStage />,
});

// The terminal's own type. The variables land on the embedded .intel-root
// only (frame.css bridges them to --rd-mono/--rd-sans), so the home shell
// keeps --font-mono/--font-sans.
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

// Pre-visit placeholder: the stage color + a mono label. No fake data, no
// spinner — the real body (and its fetch loops) mounts on first visit.
function IdleStage() {
  return (
    <div className="intel-embed-idle">
      <span>MARKET INTEL</span>
    </div>
  );
}

export default function IntelDeckSurface({ active }: { active: boolean }) {
  // Lazy-mount latch: the feed's fetch loops may not run for users sitting on
  // the floor. Once visited, it STAYS mounted so selection state survives
  // view switches. Render-phase setState is the documented "derive state from
  // props" latch — no effect needed.
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);

  return (
    // The frame's transform makes it the containing block for the feed's
    // position:fixed layers (the phone idea sheet + scrim) — nothing inside
    // can escape over the home chrome. The wrapper rides the
    // .intel-root.intel-embedded contracts in frame.css: internal scroll,
    // token scope.
    <div className="intel-embed-frame">
      <div className={`intel-root intel-embedded ${rdMono.variable} ${rdSans.variable}`}>
        {visited ? <IdeasFeed /> : <IdleStage />}
      </div>
    </div>
  );
}
