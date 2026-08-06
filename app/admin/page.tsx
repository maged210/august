import type { Metadata } from "next";
import AdminConsole from "@/components/admin/AdminConsole";

// CORE V2 — the trade-ideas admin console. The PAGE is public shell only:
// every read/write goes through /api/admin/* behind lib/admin's dual gate
// (Bearer ADMIN_TOKEN or owner session), so there is nothing to leak here —
// the client shows a token prompt when the API answers 401/403. Unlinked from
// all public nav and noindexed.
export const metadata: Metadata = {
  title: "Admin · AUGUST",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminConsole />;
}
