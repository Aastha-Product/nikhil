"use client";

import { useState, useTransition } from "react";
import { restoreVersion } from "@/app/actions";

export default function VersionRestore({ companyId, versionId }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  return (
    <>
      <button
        type="button"
        className="btn-text"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await restoreVersion(companyId, versionId);
            if (!res.ok) setError(res.error);
          })
        }
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error && <span className="form-msg error">{error}</span>}
    </>
  );
}
