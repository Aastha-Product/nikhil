"use client"; // Error boundaries must be Client Components

// Shown instead of Next's generic "Application error" when a page can't load —
// most often because the database (Supabase) is briefly unreachable. The sidebar stays.

import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, retry }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="card error-card" role="alert">
      <div className="error-icon" aria-hidden>!</div>
      <h1>We couldn’t load your research right now</h1>
      <p className="muted">
        This usually means the database is briefly unavailable. Your watchlist and research are safe — nothing was lost.
        Please try again in a moment.
      </p>
      <div className="error-actions">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>Try again</button>
        <Link href="/" className="btn btn-outline">Go to New research</Link>
      </div>
      {error?.digest && <p className="muted small">Reference: {error.digest}</p>}
    </section>
  );
}
