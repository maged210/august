import { ImageResponse } from "next/og";

// The circle mark as a PNG favicon — SVG favicons don't render in Safari.

export const size = { width: 64, height: 64 };
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

export default function Icon() {
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
          borderRadius: 14,
        }}
      >
        <Ring d={46} border="2px solid #E8E6E1d9">
          <Ring d={32} border="1.5px solid #8A8A9099">
            <Ring d={19} border="1.5px solid #E8E6E1cc">
              <div style={{ width: 7, height: 7, borderRadius: 9999, background: "#6E8CA8" }} />
            </Ring>
          </Ring>
        </Ring>
      </div>
    ),
    size,
  );
}
