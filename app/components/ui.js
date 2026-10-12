// Presentational helpers shared by the pages (server components).

export const TIER_TEXT = { A: "Worth calling", B: "Nurture", C: "Later" };

export function TierPill({ tier }) {
  if (!tier) return <span className="tier-pill tier-none">Not scored</span>;
  return (
    <span className={`tier-pill tier-${tier}`}>
      <b>{tier}</b> {TIER_TEXT[tier]}
    </span>
  );
}

/** Horizontal score meter: fill colored by tier, track a lighter step of the same ramp. */
export function ScoreMeter({ score, tier }) {
  if (score == null) return <span className="muted">—</span>;
  return (
    <div className="score-meter" title={`Fit score ${score}/100 · Tier ${tier}`}>
      <span className="score-num">{score}</span>
      <span className="meter">
        <span className={`meter-fill fill-${tier}`} style={{ width: `${score}%` }} />
      </span>
    </div>
  );
}

/** Circular score for headers and cards. */
export function ScoreRing({ score, tier, size = 64 }) {
  const stroke = size >= 80 ? 8 : 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }} title={`Fit score ${score}/100 · Tier ${tier}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className={`ring-fill stroke-${tier}`}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(c * (score ?? 0)) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-label" style={{ fontSize: size >= 80 ? 26 : 18 }}>{score ?? "—"}</span>
    </div>
  );
}

export function Avatar({ org, name, size = 36 }) {
  if (!org) {
    const initials = String(name).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    return <span className="avatar avatar-initials" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>{initials}</span>;
  }
  return (
    // GitHub serves org avatars at github.com/<org>.png; a plain img keeps it dependency-free.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="avatar"
      src={`https://github.com/${org}.png?size=${size * 2}`}
      alt={`${name} logo`}
      width={size}
      height={size}
      loading="lazy"
    />
  );
}

export function Chip({ children, tone = "default", title }) {
  return <span className={`chip chip-${tone}`} title={title}>{children}</span>;
}

const SOURCE_LABEL = { github: "GitHub", jobs: "Jobs", web: "Web" };
export function SourceTags({ sources }) {
  return (
    <span className="sources-tags">
      {sources.map((s) => <span key={s} className={`src src-${s}`}>{SOURCE_LABEL[s] ?? s}</span>)}
    </span>
  );
}

export function Confidence({ level }) {
  if (!level) return null;
  return (
    <span className={`conf conf-${level.toLowerCase()}`} title="How many live sources returned data">
      <span className="conf-dots" aria-hidden>
        <i /><i /><i />
      </span>
      {level} confidence
    </span>
  );
}

/** Categorical stacked bar with a legend (identity never by color alone). */
export function StackedBar({ items, label }) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <figure className="stacked">
      <div className="stacked-bar" role="img" aria-label={label}>
        {items.map((it, k) =>
          it.value > 0 ? (
            <span
              key={it.name}
              className={`seg ${it.className ?? `cat-${k + 1}`}`}
              style={{ flexGrow: it.value / total }}
              title={`${it.name}: ${it.display ?? it.value}`}
            />
          ) : null
        )}
      </div>
      <figcaption className="legend">
        {items.map((it, k) => (
          <span key={it.name} className="legend-item">
            <i className={`swatch ${it.className ?? `cat-${k + 1}`}`} />
            {it.name} <span className="muted">{it.display ?? it.value}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

// ── Research status (§7) and evidence labels (§6) ──
const RESEARCH_STATUS = {
  queued: ["Queued", "pending"],
  researching: ["Researching…", "pending"],
  ready: ["Ready", "ok"],
  partial: ["Partial", "warn"],
  failed: ["Failed", "bad"],
};
export function ResearchStatus({ status }) {
  const [label, tone] = RESEARCH_STATUS[status] ?? ["Unknown", "pending"];
  return <span className={`rstatus rstatus-${tone}`}>{label}</span>;
}

export const SOURCE_TYPE_LABELS = {
  repository: "Code repository",
  job_posting: "Job posting",
  engineering_blog: "Engineering blog",
  conference_talk: "Conference talk",
  company_page: "Company page",
  third_party: "Third-party article",
  api: "API",
};
export const EVIDENCE_STATUS_LABELS = {
  directly_stated: "Directly stated",
  technically_observed: "Technically observed",
  inferred: "Inferred",
  conflicting: "Conflicting",
  unavailable: "Unavailable",
};
export const CATEGORY_LABELS = {
  language: "Programming languages",
  infrastructure: "Cloud & infrastructure",
  activity: "Engineering activity",
  context: "Company engineering context",
  sales_relevance: "Sales relevance",
};

export function ConfidenceBadge({ level }) {
  if (!level) return null;
  const l = String(level).toLowerCase();
  return (
    <span className={`conf conf-${l}`} title="Rule-based: source tier, specificity, recency and corroboration">
      <span className="conf-dots" aria-hidden><i /><i /><i /></span>
      {l[0].toUpperCase() + l.slice(1)}
    </span>
  );
}

const FRESHNESS = { current: "Current", aging: "Aging", stale: "Stale", unknown: "Date unknown" };
export function FreshnessBadge({ value }) {
  return <span className={`fresh fresh-${value}`}>{FRESHNESS[value] ?? value}</span>;
}

export function formatDate(iso) {
  if (!iso) return "date unavailable";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function isStale(iso) {
  return !iso || Date.now() - new Date(iso).getTime() > 7 * 24 * 60 * 60 * 1000;
}

export const STATUS_LABELS = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting booked",
  won: "Won",
  lost: "Lost",
};

export function SetupNeeded() {
  return (
    <section className="card setup">
      <h2>Connect your accounts to start</h2>
      <p>The app is running, but it needs your keys before it can pull live research.</p>
      <ol>
        <li>Create a Supabase project and run <code>supabase/schema.sql</code>, then <code>supabase/migrations/002_evidence_and_runs.sql</code>, in its SQL Editor.</li>
        <li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in every value.</li>
        <li>Restart the app, then run the first refresh (see README → “First refresh”).</li>
      </ol>
    </section>
  );
}
