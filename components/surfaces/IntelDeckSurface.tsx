"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { IBM_Plex_Mono, Hanken_Grotesk } from "next/font/google";
import "@/app/intel/tokens.css";
import "@/app/intel/intel.css";

// The Terminal view's body is AUDIENCE-AWARE:
//   owner → the full intel desk, embedded (on phones the desk's own ≤700px
//   MobileBoard tree renders — the standalone /intel route is retired, so the
//   embed is the owner's only desk on every viewport);
//   everyone else → the public IDEAS feed (owner-published, server-redacted).
// Both bodies are dynamic chunks behind the same lazy-mount latch — nothing
// intel-sized rides the home bundle for users who stay on Chat, and the
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

export default function IntelDeckSurface({
  active,
  onExitToChat,
}: {
  active: boolean;
  /** CORE V2 — switch back to the Chat view client-side (threaded to the
   *  desk chrome's AUGUST / ← AUGUST controls so they never full-reload). */
  onExitToChat?: () => void;
}) {
  // Lazy-mount latch: neither body's fetch loops may run for users sitting on
  // Chat. Once visited, it STAYS mounted so tab/selection/quote state
  // survives view switches. Render-phase setState is the documented "derive
  // state from props" latch — no effect needed.
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);

  // Audience signal — starts unknown so the first paint is the idle stage on
  // server and client alike (no hydration seam). GET /api/intel/role once per
  // mount, only after first visit; a fetch failure honestly degrades to the
  // public feed.
  const [owner, setOwner] = useState<boolean | null>(null);

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

  const mode: "idle" | "desk" | "feed" =
    !visited || owner === null ? "idle" : owner ? "desk" : "feed";

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
          <IdeasFeed />
        </div>
      ) : (
        <div className={`intel-root cinematic intel-embedded ${rdMono.variable} ${rdSans.variable}`}>
          {mode === "desk" ? <IntelDashboard onExitToChat={onExitToChat} /> : <IdleStage />}
        </div>
      )}
    </div>
  );
}
