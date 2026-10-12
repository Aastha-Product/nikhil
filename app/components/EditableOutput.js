"use client";

// Edit / Regenerate / Regenerate with feedback for one generated output (architecture doc §9).
// Hidden behind "Improve" so the report stays calm; these only change wording, never the evidence.

import { useState, useTransition } from "react";
import { regenerateOutput, saveEdit } from "@/app/actions";
import CopyButton from "./CopyButton";

export default function EditableOutput({ companyId, type, content, origin, children }) {
  const [mode, setMode] = useState("view"); // view | menu | edit | feedback
  const [draft, setDraft] = useState(content ?? "");
  const [feedback, setFeedback] = useState("");
  const [msg, setMsg] = useState(null);
  const [pending, startTransition] = useTransition();

  const run = (fn) =>
    startTransition(async () => {
      setMsg(null);
      const res = await fn();
      if (!res.ok) setMsg({ tone: "error", text: res.error });
      else {
        setMode("view");
        setFeedback("");
        setMsg(res.note ? { tone: "warn", text: res.note } : { tone: "ok", text: "Updated. The evidence underneath was not changed." });
      }
    });

  return (
    <div className="editable">
      {mode === "edit" ? (
        <textarea className="input textarea" value={draft} onChange={(e) => setDraft(e.target.value)} rows={type === "summary" ? 10 : 3} aria-label="Edit text" />
      ) : (
        children
      )}

      <div className="edit-bar">
        <span className="origin muted small">{ORIGIN[origin] ?? "Written by Gemini Flash"}</span>
        <div className="edit-actions">
          {mode === "view" && (
            <>
              {type === "first_line" && content && <CopyButton text={content} />}
              <button type="button" className="btn-text" onClick={() => setMode("menu")}>Improve</button>
            </>
          )}
          {mode === "menu" && (
            <>
              <button type="button" className="btn-text" disabled={pending} onClick={() => run(() => regenerateOutput(companyId, type))}>
                {pending ? "Rewriting…" : "Rewrite"}
              </button>
              <button type="button" className="btn-text" disabled={pending} onClick={() => setMode("feedback")}>Rewrite with my note</button>
              <button type="button" className="btn-text" disabled={pending} onClick={() => { setDraft(content ?? ""); setMode("edit"); }}>Edit myself</button>
              <button type="button" className="btn-text subtle" disabled={pending} onClick={() => setMode("view")}>Close</button>
            </>
          )}
          {mode === "edit" && (
            <>
              <button type="button" className="btn btn-small" disabled={pending} onClick={() => run(() => saveEdit(companyId, type, draft))}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn-text subtle" disabled={pending} onClick={() => setMode("view")}>Cancel</button>
            </>
          )}
        </div>
      </div>

      {mode === "feedback" && (
        <div className="feedback-row">
          <input
            className="input"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={500}
            autoFocus
            placeholder={type === "summary" ? "e.g. Make the infrastructure part clearer" : "e.g. Shorter, and lead with their hiring"}
            aria-label="Your note for Gemini"
          />
          <button type="button" className="btn btn-small" disabled={pending || feedback.trim().length < 3} onClick={() => run(() => regenerateOutput(companyId, type, feedback))}>
            {pending ? "Rewriting…" : "Rewrite"}
          </button>
          <button type="button" className="btn-text subtle" disabled={pending} onClick={() => setMode("view")}>Cancel</button>
        </div>
      )}
      {msg && <p className={`form-msg ${msg.tone}`} role="status">{msg.text}</p>}
    </div>
  );
}

const ORIGIN = {
  ai_refresh: "Written by Gemini Flash from this week’s evidence",
  ai_regenerate: "Rewritten by Gemini Flash from the same evidence",
  ai_feedback: "Rewritten with your note",
  edited: "Edited by you",
  restored: "Restored from an earlier version",
};
