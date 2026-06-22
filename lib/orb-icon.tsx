import type { ReactElement } from "react";

// The AUGUST orb mark as JSX for next/og ImageResponse — shared by the PWA icon
// route handlers (/icon-192, /icon-512, /icon-maskable). Mirrors the concentric-ring
// look of app/icon.tsx + app/apple-icon.tsx, scaled to any size. ImageResponse only
// supports a CSS subset (flexbox; every multi-child div needs display:flex), which
// this respects — each Ring has a single centered child.

function Ring({
  d,
  border,
  children,
}: {
  d: number;
  border: string;
  children?: ReactElement;
}): ReactElement {
  return (
    <div
      style={{
        width: d,
        height: d,
        borderRadius: 9999,
        border,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

/** Orb-on-black icon. maskable=true shrinks the orb into the central safe zone
 *  (≤80% of width) so adaptive-icon masking never clips it. */
export function OrbIcon({ size, maskable = false }: { size: number; maskable?: boolean }): ReactElement {
  const k = maskable ? 0.5 : 0.72; // outer-ring diameter as a fraction of the canvas
  const outer = size * k;
  const mid = outer * 0.7;
  const inner = outer * 0.42;
  const dot = outer * 0.14;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
      }}
    >
      <Ring d={outer} border={`${Math.max(2, size * 0.02)}px solid #E8E6E1d9`}>
        <Ring d={mid} border={`${Math.max(1.5, size * 0.015)}px solid #8A8A9099`}>
          <Ring d={inner} border={`${Math.max(1.5, size * 0.018)}px solid #E8E6E1cc`}>
            <div style={{ width: dot, height: dot, borderRadius: 9999, background: "#6E8CA8" }} />
          </Ring>
        </Ring>
      </Ring>
    </div>
  );
}
