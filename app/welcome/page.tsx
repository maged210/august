// /welcome — the one-screen first-run setup (stage 3). Two light sections:
// the watchlist (seeded SPY QQQ BRK-B NVDA TSLA, editable) and the three feed
// toggles. Start saves both and marks the account onboarded; "Skip for now"
// saves nothing (the seed already stands) and marks onboarded so the nudge
// never repeats. Revisiting later (the landing's gear) shows the same screen
// titled "Your setup" — onboarding IS the settings surface; no second UI.
//
// Server component gate:
//   auth unconfigured  → redirect("/")     (single-user fallback has no accounts)
//   signed out         → redirect("/login")
//   signed in          → render, with the onboarded flag deciding the framing.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, authConfigured } from "@/auth";
import { getOnboarded } from "@/lib/user-scope";
import WelcomeSetup from "@/components/WelcomeSetup";

export const metadata: Metadata = { title: "AUGUST — your setup" };

// Always render per-request (same reasoning as /login): the configured check
// and the session must reflect the RUNTIME env, never a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  if (!authConfigured) redirect("/");
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  const onboarded = await getOnboarded(email);
  return <WelcomeSetup onboarded={onboarded} />;
}
