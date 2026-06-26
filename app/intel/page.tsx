import type { Metadata } from "next";
import "./intel.css";
import IntelDashboard from "@/components/intel/IntelDashboard";

// AUGUST Market Intel — a top-level destination at /intel. Dynamic (live data,
// never statically optimized). The dashboard itself is a client component.
export const metadata: Metadata = {
  title: "Market Intel · AUGUST",
  description: "Creator market-prep videos, turned into evidence-backed nightly intelligence.",
};
export const dynamic = "force-dynamic";

export default function IntelPage() {
  return (
    <main className="intel-root">
      <IntelDashboard />
    </main>
  );
}
