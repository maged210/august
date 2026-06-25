// Brief history — the dates we have briefs for.
import { listBriefDates } from "@/lib/intel/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ dates: await listBriefDates(60) });
}
