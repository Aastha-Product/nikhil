"use client"; // Error boundaries must be Client Components

// Last-resort page if even the app frame fails. It renders its own document, so styles are inline.

export default function GlobalError({ error, retry }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f5f2", fontFamily: "system-ui, sans-serif", color: "#17181a" }}>
        <title>Tech Stack Scout — temporarily unavailable</title>
        <main style={{ maxWidth: 520, margin: 24, padding: 32, background: "#fff", border: "1px solid #e9e6e0", borderRadius: 18, textAlign: "center", boxShadow: "0 12px 32px rgba(23,24,26,0.08)" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 10px" }}>Tech Stack Scout is temporarily unavailable</h1>
          <p style={{ color: "#6c6f76", lineHeight: 1.6, margin: "0 0 20px" }}>
            We couldn’t reach one of our services. Your watchlist and research are safe — nothing was lost. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ font: "inherit", fontWeight: 600, padding: "11px 20px", borderRadius: 10, border: 0, color: "#fff", cursor: "pointer", background: "linear-gradient(135deg, #5b5bf0, #2a78d6)" }}
          >
            Try again
          </button>
          {error?.digest && <p style={{ color: "#6c6f76", fontSize: 13, marginTop: 16 }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
