// Small presentational helpers shared by the pages (server components).

export function TierBadge({ tier, score }) {
  if (!tier) return <span className="tier tier-none">—</span>;
  return (
    <span className={`tier tier-${tier}`} title={`Tier ${tier}`}>
      {score ?? ""}<small>{tier}</small>
    </span>
  );
}

export function Chip({ children, tone = "default", title }) {
  return <span className={`chip chip-${tone}`} title={title}>{children}</span>;
}

export function Confidence({ level }) {
  if (!level) return null;
  return <span className={`conf conf-${level.toLowerCase()}`}>{level} confidence</span>;
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
        <li>Create a Supabase project and run <code>supabase/schema.sql</code> in its SQL Editor.</li>
        <li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in every value.</li>
        <li>Restart the app, then run the first refresh (see README → “First refresh”).</li>
      </ol>
    </section>
  );
}
