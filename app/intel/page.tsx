import { redirect } from "next/navigation";

// The desk moved back onto the command deck as a slide. /intel survives only as
// a server-side redirect so old bookmarks, watcher pushes, and muscle memory
// all land on the desk surface. (The dashboard now owns its stylesheet — see
// components/intel/IntelDashboard.tsx — so nothing is imported here.)
export const dynamic = "force-dynamic";

export default function IntelPage(): never {
  redirect("/?screen=desk");
}
