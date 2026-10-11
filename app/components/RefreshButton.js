"use client";

import { useState, useTransition } from "react";
import { refreshNow } from "@/app/actions";

export default function RefreshButton({ companyId }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(null);

  return (
    <div className="refresh">
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const res = await refreshNow(companyId);
            setMessage(res.ok ? "Updated with live data" : res.error);
          })
        }
      >
        {pending ? "Researching… (~30s)" : "Refresh now"}
      </button>
      {message && <span className="muted small">{message}</span>}
    </div>
  );
}
