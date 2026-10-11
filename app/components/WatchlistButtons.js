"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeCompany, restoreCompany } from "@/app/actions";

export function RemoveButton({ companyId, name, redirectHome = false }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const router = useRouter();
  return (
    <span className="inline-action">
      <button
        type="button"
        className="btn-text danger"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Remove ${name} from the watchlist? Its research history is kept and it can be restored.`)) return;
          startTransition(async () => {
            const res = await removeCompany(companyId);
            if (!res.ok) setError(res.error);
            else if (redirectHome) router.push("/");
          });
        }}
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && <span className="form-msg error">{error}</span>}
    </span>
  );
}

export function RestoreButton({ companyId }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  return (
    <span className="inline-action">
      <button
        type="button"
        className="btn-text"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await restoreCompany(companyId);
            if (!res.ok) setError(res.error);
          })
        }
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error && <span className="form-msg error">{error}</span>}
    </span>
  );
}
