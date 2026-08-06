import { redirect } from "next/navigation";

// CORE V2 — the standalone desk route is retired; the Intel Terminal lives at
// / as a view. The embed's audience split (owner → desk, everyone else → the
// public ideas feed, same fail-closed role signal) replaces the old server
// gate here. The app/api/intel/* routes are untouched — tests pin their paths.
export const dynamic = "force-dynamic";

export default function IntelPage() {
  redirect("/?view=terminal");
}
