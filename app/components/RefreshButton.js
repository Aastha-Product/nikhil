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
            setMessage(
              !res.ok
                ? { tone: "error", text: res.error }
                : res.partial
                  ? { tone: "warn", text: "Updated, but some sources failed — see research gaps." }
                  : { tone: "ok", text: "Updated with live evidence." }
            );
          })
        }
      >
        {pending ? "Researching… (~1 min)" : "Refresh now"}
      </button>
      {message && <span className={`form-msg ${message.tone}`}>{message.text}</span>}
    </div>
  );
}
