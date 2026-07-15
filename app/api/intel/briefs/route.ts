// Brief history — the dates we have briefs for. Dates carry no attribution, so
// the list stays public; ownerView tells the client which view briefs/[date]
// will serve it (owner = full provenance, everyone else = redacted).
import { listBriefDates } from "@/lib/intel/store";
import { intelOwnerView } from "@/lib/intel/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const [dates, ownerView] = await Promise.all([listBriefDates(60), intelOwnerView()]);
  return Response.json({ dates, ownerView });
}
