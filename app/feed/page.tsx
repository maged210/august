import type { Metadata } from "next";
import { IBM_Plex_Mono, Hanken_Grotesk } from "next/font/google";
import "../intel/tokens.css";
import "../intel/feed.css";
import IdeasFeed from "@/components/surfaces/IdeasFeed";
import { getIntelRoleSignal } from "@/lib/user-scope";

// AUGUST DESK — the standalone, shareable audience URL for the public ideas
// feed. No auth anywhere: it renders EXACTLY what GET /api/intel/feed serves
// (owner-published, server-redacted cards). The one owner nicety is the
// OPEN DESK link inside the feed header, gated by the same server-derived
// role signal the desk uses — booleans only, no identity values.
//
// Class scaffolding (same contract as the home deck's embed, minus the deck):
//   .intel-embed-frame  → rd- token scope (tokens.css targets it directly,
//                         and the DAY DESK light re-pins target it too) +
//                         the stage background + the transform that makes it
//                         the containing block for the feed's fixed layers
//                         (bottom sheet + scrim pin to the frame).
//   .intel-root.intel-embedded → internal scroller (height:100%, overflow-y).
//
// SCROLL DECISION (deliberate): the root carries .intel-embedded and scrolls
// INTERNALLY. globals.css locks body overflow app-wide, and this page does
// NOT import intel.css — so its body:has(.intel-root:not(.intel-embedded))
// unlock never exists here; the body stays locked on phone + desktop and the
// feed scrolls inside the full-viewport frame (100dvh keeps iOS URL-bar
// resizes honest). The sticky .if-chrome header pins inside that scroller.

// Same font config as app/intel/page.tsx — two next/font instances of the
// same font dedupe at build time. Variables land on the frame so the rd-
// token scope (--rd-mono/--rd-sans on .intel-root AND .intel-embed-frame)
// resolves; nothing outside this page inherits them.
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

export const metadata: Metadata = {
  title: "Ideas · AUGUST DESK",
  description: "Published trade ideas with stated levels and live tracking.",
};
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  // Owner-only OPEN DESK link — server-derived (reads the session cookie,
  // returns booleans). Visitors and signed-in non-owners get the pure feed.
  const role = await getIntelRoleSignal();
  return (
    <main
      className={`intel-embed-frame ${rdMono.variable} ${rdSans.variable}`}
      // .intel-embed-frame declares height:100% for the deck panel; standalone
      // there is no sized ancestor, so pin the frame to the viewport here
      // (layout only — every color stays in the tokens).
      style={{ height: "100dvh" }}
    >
      <div className="intel-root intel-embedded">
        <IdeasFeed showDeskLink={role.owner} />
      </div>
    </main>
  );
}
