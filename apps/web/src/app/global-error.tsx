"use client";

/**
 * Last resort: a throw in the root layout itself, which no other boundary can
 * catch. It replaces the root layout, so it owns `<html>`/`<body>` and cannot
 * rely on the stylesheet the layout would have loaded. Hence inline styles.
 *
 * Everything else is caught one level down by app/error.tsx.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#fff",
          color: "#171717",
        }}
      >
        <div style={{ maxWidth: "28rem", padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 400 }}>
            Something went wrong
          </h1>
          <p style={{ color: "#737373", fontSize: "0.875rem" }}>
            Reloading usually clears this.
          </p>
          {/* A hard reload, not a Link: a client-side navigation would only
              re-render the tree that just failed. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 1rem",
              border: "none",
              borderRadius: "0.375rem",
              background: "#171717",
              color: "#fff",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: "1.5rem",
                color: "#a3a3a3",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
              }}
            >
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
