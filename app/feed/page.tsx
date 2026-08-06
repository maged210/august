import { redirect } from "next/navigation";

// CORE V2 — the standalone audience URL is retired; the public ideas feed
// renders inside the Terminal view at /?view=terminal (the embed serves it to
// every non-owner). Old shared links land exactly where the content moved.
export const dynamic = "force-dynamic";

export default function FeedPage() {
  redirect("/?view=terminal");
}
