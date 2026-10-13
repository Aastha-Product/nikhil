// Company size check (lib/size.js): shown next to, never mixed into, the fit score.

const ICON = { pass: "✓", below: "↓", above: "↑", unknown: "?" };
const BASIS = { reported: "From source", estimate: "Estimate", unknown: "Not found" };

export function SizePill({ size, quiet = false }) {
  if (!size || (quiet && ["unknown", "partial"].includes(size.status))) return null;
  return (
    <span className={`size-pill size-${size.status}`} title={size.reason}>
      {size.status === "in_range" && quiet ? "✓ Size fits" : size.label}
    </span>
  );
}

export default function SizeCard({ size, checkedAt }) {
  if (!size) return null;
  return (
    <section className={`card size-card size-${size.status}`} aria-labelledby="size-title">
      <div className="size-head">
        <div>
          <div className="label">Company size · checked separately from the fit score</div>
          <h2 id="size-title" className="size-title">{size.label}</h2>
          <p className="size-reason">{size.reason}</p>
        </div>
      </div>
      <ul className="size-checks">
        {size.checks.map((c) => (
          <li key={c.key} className={`size-check res-${c.result}`}>
            <span className="size-icon" aria-hidden>{ICON[c.result]}</span>
            <div className="size-body">
              <div className="size-row">
                <b>{c.label}</b>
                <span className="size-value">{c.value}</span>
              </div>
              <div className="muted small">
                Target: {c.threshold}
                {c.note && <> · {c.note}</>}
              </div>
              <div className="size-meta small">
                <span className={`basis basis-${c.basis}`}>{BASIS[c.basis]}</span>
                {c.source?.url && <a href={c.source.url} target="_blank" rel="noreferrer">{c.source.title} ↗</a>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small size-foot">
        These limits are our assumption about who FlowForge sells to (ideal customer: {size.thresholds.min_engineers.toLocaleString("en-IN")}–{size.thresholds.max_engineers.toLocaleString("en-IN")} engineers),
        editable in Supabase (product_profile). Figures come from public sources{checkedAt ? `, checked ${new Date(checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}. Free sources
        mostly cover large or listed companies; confirm on LinkedIn when a figure is unknown.
      </p>
    </section>
  );
}
