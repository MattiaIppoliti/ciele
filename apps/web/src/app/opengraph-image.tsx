import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background:
            "linear-gradient(135deg, #d7e6e8 0%, #eef3ed 48%, #f5e3c9 100%)",
          color: "#18343b",
          display: "flex",
          height: "100%",
          justifyContent: "space-between",
          padding: "76px 88px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: 790,
          }}
        >
          <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: -1 }}>
            Ciele
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 70,
              fontWeight: 600,
              letterSpacing: -3,
              lineHeight: 1.08,
              marginTop: 42,
            }}
          >
            <div>AI teammates,</div>
            <div>grounded in your knowledge.</div>
          </div>
          <div
            style={{
              color: "#466168",
              fontSize: 27,
              lineHeight: 1.35,
              marginTop: 30,
            }}
          >
            Build, test, and publish AI assistants for your organization.
          </div>
        </div>
        <div
          style={{
            alignItems: "center",
            background: "#466168",
            border: "14px solid #fff",
            borderRadius: 84,
            color: "#fff",
            display: "flex",
            fontSize: 86,
            fontWeight: 700,
            height: 168,
            justifyContent: "center",
            width: 168,
          }}
        >
          C
        </div>
        <div
          style={{
            bottom: 48,
            color: "#466168",
            fontSize: 22,
            position: "absolute",
            right: 88,
          }}
        >
          ciele.app
        </div>
      </div>
    ),
    size
  );
}
