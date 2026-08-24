"use client";

/**
 * Root-level error boundary. Replaces the whole document when a render error
 * escapes the root layout, so it must render <html>/<body> itself.
 *
 * Providing this explicitly also stops Next from prerendering its internal
 * default `/_global-error` page, which crashes during static export in this
 * Next/React combination.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0b0b0c",
          color: "#e9e9ea",
        }}
      >
        <div style={{ maxWidth: "28rem", padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.7, margin: "0 0 1.25rem" }}>
            An unexpected error occurred. Try again, and contact your
            administrator if it keeps happening.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                opacity: 0.5,
                fontFamily: "ui-monospace, monospace",
                margin: "0 0 1.25rem",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              cursor: "pointer",
              borderRadius: "0.375rem",
              border: "1px solid #3a3a3d",
              background: "#18181b",
              color: "inherit",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
