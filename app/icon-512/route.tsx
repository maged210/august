import { ImageResponse } from "next/og";
import { OrbIcon } from "@/lib/orb-icon";

// 512×512 PWA icon (manifest src "/icon-512").
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(<OrbIcon size={512} />, { width: 512, height: 512 });
}
