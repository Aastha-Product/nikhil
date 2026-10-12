import StartResearch from "./components/StartResearch";

// Starting research runs in the background (after()) from this page's server action.
export const maxDuration = 300;

const STEPS = [
  ["Collect", "Public code, official job posts and engineering articles"],
  ["Verify", "Every finding gets a source, a date and a confidence rating"],
  ["Write", "Gemini drafts a summary and an opening line from the evidence"],
];

export default function NewResearch() {
  return (
    <section className="research">
      <div className="research-head">
        <span className="start-badge"><span className="live-dot" aria-hidden /> Live public data · about 1 minute</span>
        <h1>Who are you calling next?</h1>
        <p className="muted">Enter the company. We’ll research how it builds software and draft your opening line.</p>
      </div>

      <div className="research-card">
        <StartResearch />
      </div>

      <ol className="steps" aria-label="What happens next">
        {STEPS.map(([title, text], k) => (
          <li key={title}>
            <span className="step-num">{k + 1}</span>
            <span>
              <b>{title}</b>
              <span className="muted small">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="muted small center">Public sources only. Nothing is sent to the company.</p>
    </section>
  );
}
