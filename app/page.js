import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { computeMetrics, getWatchlist } from "@/lib/data";
import { isConfigured } from "@/lib/supabaseAdmin";
import StartResearch from "./components/StartResearch";
import { Avatar, SetupNeeded, timeAgo } from "./components/ui";

// Starting research runs in the background (after()) from this page's server action.
export const maxDuration = 300;

export default function Start() {
  return (
    <section className="start">
      <div className="start-head">
        <span className="start-badge"><span className="live-dot" aria-hidden /> Live public data · Gemini Flash</span>
        <h1>Hi Nikhil, what would you like to do?</h1>
        <p className="muted">Know how a company builds software before your first call, with every finding linked to its source.</p>
      </div>

      <div className="choices">
        <article className="choice choice-primary">
          <div className="choice-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2-1.4 1.4-4.2-4.2A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" fill="currentColor" /></svg>
          </div>
          <h2>Research a new company</h2>
          <p className="muted">We’ll gather its public code, job posts and engineering articles, then draft a summary and an opening line.</p>
          <StartResearch />
        </article>

        <Suspense fallback={<WatchlistChoice loading />}>
          <WatchlistChoiceData />
        </Suspense>
      </div>
    </section>
  );
}

async function WatchlistChoiceData() {
  await connection();
  if (!isConfigured()) return <SetupNeeded />;
  const { active } = await getWatchlist();
  const m = computeMetrics(active);
  const recent = [...active]
    .filter((c) => c.intel?.last_refreshed)
    .sort((a, b) => (b.intel.last_refreshed > a.intel.last_refreshed ? 1 : -1))
    .slice(0, 4);
  return <WatchlistChoice m={m} recent={recent} />;
}

function WatchlistChoice({ m, recent = [], loading = false }) {
  return (
    <article className="choice">
      <div className="choice-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 5h16v2H4V5Zm0 6h16v2H4v-2Zm0 6h10v2H4v-2Z" fill="currentColor" /></svg>
      </div>
      <h2>Open my watchlist</h2>
      <p className="muted">See the companies you’re tracking, ranked by how well they fit FlowForge.</p>

      {loading ? (
        <div className="choice-stats skeleton" />
      ) : (
        <dl className="choice-stats">
          <div><dt>Companies</dt><dd>{m.total}</dd></div>
          <div><dt>Worth calling</dt><dd>{m.tierA}</dd></div>
          <div><dt>Updated</dt><dd className="small-dd">{timeAgo(m.lastRefresh)}</dd></div>
        </dl>
      )}

      <Link href="/watchlist" className="btn btn-outline btn-lg btn-block">Open watchlist →</Link>

      {recent.length > 0 && (
        <div className="recent">
          <div className="label">Jump back in</div>
          <div className="recent-list">
            {recent.map((c) => (
              <Link key={c.id} href={`/company/${c.id}`} className="recent-chip">
                <Avatar org={c.github_org} name={c.name} size={20} />
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
