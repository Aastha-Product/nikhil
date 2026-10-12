"use client";

// Start-screen option 1: research a new company. Two fields up front; the rest hidden under "More options".

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addCompany } from "@/app/actions";

export default function StartResearch({ autoFocus = false }) {
  const [state, action, pending] = useActionState(addCompany, null);
  const [more, setMore] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok && state.id) router.push(`/company/${state.id}`);
  }, [state, router]);

  return (
    <form action={action} className="start-form">
      <label className="field">
        <span className="field-label">Company name</span>
        <input className="input input-lg" name="name" required maxLength={80} placeholder="e.g. Datadog" autoFocus={autoFocus} autoComplete="off" />
      </label>
      <label className="field">
        <span className="field-label">Website <span className="muted">· helps us find the right company</span></span>
        <input className="input input-lg" name="website" placeholder="e.g. datadoghq.com" autoComplete="off" />
      </label>

      {more ? (
        <div className="form-grid two">
          <label className="field">
            <span className="field-label">GitHub handle (optional)</span>
            <input className="input mono" name="github_org" placeholder="e.g. DataDog" autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">Job board (optional)</span>
            <input className="input mono" name="job_board" placeholder="e.g. greenhouse:datadog" autoComplete="off" />
          </label>
        </div>
      ) : (
        <button type="button" className="btn-text subtle" onClick={() => setMore(true)}>+ More options</button>
      )}

      <button type="submit" className="btn btn-lg btn-block" disabled={pending || state?.ok}>
        {pending || state?.ok ? "Starting research…" : "Start research"}
      </button>
      {state?.error && (
        <p className="form-msg error" role="alert">
          {state.error} {state.existingId && <Link href={`/company/${state.existingId}`}>Open its report →</Link>}
        </p>
      )}
      <p className="muted small center">Takes about a minute. Uses public sources only; nothing is sent to the company.</p>
    </form>
  );
}
