import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IBM_Plex_Mono, Hanken_Grotesk } from "next/font/google";
import "./intel.css";
import "./tokens.css";
import IntelDashboard from "@/components/intel/IntelDashboard";
import { getIntelRoleSignal } from "@/lib/user-scope";

// Redesign chrome fonts (SPEC-desktop §1.6). Exposed as CSS variables on the
// .intel-root wrapper ONLY — no other route inherits them (the app shell
// keeps --font-mono/--font-sans from app/layout.tsx).
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

// AUGUST Market Intel — a top-level destination at /intel. Dynamic (live data,
// never statically optimized). The dashboard itself is a client component.
export const metadata: Metadata = {
  title: "Market Intel · AUGUST",
  description: "Creator market-prep videos, turned into evidence-backed nightly intelligence.",
};
export const dynamic = "force-dynamic";

export default async function IntelPage() {
  // AUDIENCE GATE — server-side, so there is no client flash of desk chrome.
  // /intel is the OWNER's desk; everyone else gets the public feed. The role
  // signal fails closed in production when auth is unconfigured (see
  // unconfiguredIsOwner in lib/user-scope), so a secretless deploy redirects
  // every visitor to /feed instead of leaking the desk. Local dev
  // (unconfigured + development) resolves owner:true and keeps the desk,
  // byte-identical to before; the signed-in owner — on any device, including a
  // phone or the deck's "OPEN DESK →" link — also resolves owner:true and
  // lands on the desk, the intended destination.
  const role = await getIntelRoleSignal();
  if (!role.owner) redirect("/feed");

  // `cinematic` gates the redesign's illumination layers (tokens.css §1.3) —
  // always on for now; the Flat/Minimal presets exist as future knobs.
  return (
    <main className={`intel-root cinematic ${rdMono.variable} ${rdSans.variable}`}>
      <IntelDashboard />
    </main>
  );
}
