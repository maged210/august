import { ImageResponse } from "next/og";
import { OrbIcon } from "@/lib/orb-icon";

// 192×192 PWA icon (manifest src "/icon-192"). A stable Route Handler URL, unlike
// the hashed app/icon.tsx metadata route, so the manifest reference never drifts.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(<OrbIcon size={192} />, { width: 192, height: 192 });
}
