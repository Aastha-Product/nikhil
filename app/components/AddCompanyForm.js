"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addCompany } from "@/app/actions";

export default function AddCompanyForm({ defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, action, pending] = useActionState(addCompany, null);
  const formRef = useRef(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        + Add company
      </button>
    );
  }

  return (
    <form ref={formRef} action={action} className="card add-form" id="add-company">
      <div className="add-head">
        <h2>Add a company to the watchlist</h2>
        <button type="button" className="btn-icon" aria-label="Close" onClick={() => setOpen(false)}>×</button>
      </div>
      <p className="muted small">
        The website helps us match the right GitHub account and avoid companies with similar names. Research starts as soon as you add it.
      </p>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Company name *</span>
          <input className="input" name="name" required maxLength={80} placeholder="e.g. Datadog" />
        </label>
        <label className="field">
          <span className="field-label">Website (recommended)</span>
          <input className="input" name="website" placeholder="e.g. datadoghq.com" />
        </label>
        <label className="field">
          <span className="field-label">GitHub handle (optional)</span>
          <input className="input mono" name="github_org" placeholder="e.g. DataDog" />
        </label>
        <label className="field">
          <span className="field-label">Job board (optional)</span>
          <input className="input mono" name="job_board" placeholder="e.g. greenhouse:datadog" />
        </label>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>{pending ? "Adding…" : "Add and research"}</button>
        {state?.error && <span className="form-msg error" role="alert">{state.error}</span>}
        {state?.ok && <span className="form-msg ok" role="status">{state.message}</span>}
      </div>
    </form>
  );
}
