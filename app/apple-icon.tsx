import { ImageResponse } from "next/og";

// 180×180 apple-touch-icon — what iOS shows for "Add to Home Screen".

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

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

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#08080B",
        }}
      >
        <Ring d={128} border="4px solid #E8E6E1d9">
          <Ring d={90} border="3px solid #8A8A9099">
            <Ring d={54} border="3.5px solid #E8E6E1cc">
              <div style={{ width: 18, height: 18, borderRadius: 9999, background: "#6E8CA8" }} />
            </Ring>
          </Ring>
        </Ring>
      </div>
    ),
    size,
  );
}
