import { ImageResponse } from "next/og";
import { OrbIcon } from "@/lib/orb-icon";

// 512×512 MASKABLE PWA icon (manifest src "/icon-maskable", purpose "maskable").
// The orb is shrunk into the central safe zone so adaptive-icon masking on Android
// never clips it; the full-bleed black fills whatever shape the launcher applies.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(<OrbIcon size={512} maskable />, { width: 512, height: 512 });
}
