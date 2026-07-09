import { ImageResponse } from "next/og";

// The card a texted/posted link unfurls into: dark, the mark, one line.
// Twitter inherits this image via the summary_large_image card.

export const alt = "AUGUST — a private intelligence companion";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BONE = "#E8E6E1";
const ASH = "#8A8A90";
const STEEL = "#6E8CA8";

// Satori can't resolve generic CSS families ("monospace" silently becomes the
// bundled sans) and reads TTF/OTF/WOFF only — not woff2, which is all Google
// Fonts serves now. Fetch the real TTF from JetBrains' tagged release instead;
// fall back gracefully to sans if offline.
async function loadMono(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(
      "https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@2.304/fonts/ttf/JetBrainsMono-Medium.ttf",
    );
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

function Ring({ d, border, children }: { d: number; border: string; children?: React.ReactNode }) {
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

export default async function OpengraphImage() {
  const mono = await loadMono();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 110px 0 96px",
          background: "#13151A",
          fontFamily: mono ? "JetBrains Mono" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 92, letterSpacing: 26, color: BONE }}>AUGUST</div>
          <div style={{ fontSize: 25, letterSpacing: 7, color: ASH, marginTop: 30 }}>
            A PRIVATE INTELLIGENCE COMPANION
          </div>
          <div style={{ fontSize: 15, letterSpacing: 5, color: STEEL, marginTop: 64 }}>
            LOCATION — UNDISCLOSED
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 140px ${STEEL}55`,
            borderRadius: 9999,
          }}
        >
          <Ring d={340} border={`2px solid ${BONE}cc`}>
            <Ring d={244} border={`1.5px solid ${ASH}88`}>
              <Ring d={150} border={`2px solid ${BONE}b3`}>
                <Ring d={56} border={`3px solid ${STEEL}`} />
              </Ring>
            </Ring>
          </Ring>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: mono
        ? [{ name: "JetBrains Mono", data: mono, style: "normal" as const, weight: 500 as const }]
        : undefined,
    },
  );
}
