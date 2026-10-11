import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { computeMetrics, getWatchlist } from "@/lib/data";
import { isConfigured, tableEditorUrl } from "@/lib/supabaseAdmin";
import { Chip, Confidence, isStale, SetupNeeded, STATUS_LABELS, TierBadge, timeAgo } from "./components/ui";

export default function Home({ searchParams }) {
  return (
    <>
      <section className="page-head">
        <div>
          <h1>Account watchlist</h1>
          <p className="muted">
            Ranked by fit for FlowForge. Live data from GitHub, job boards and Google Search; refreshed weekly.
          </p>
        </div>
      </section>
      <Suspense fallback={<p className="muted">Loading live research…</p>}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Dashboard({ searchParams }) {
  await connection();
  if (!isConfigured()) return <SetupNeeded />;

  const { tier } = await searchParams;
  const companies = await getWatchlist();
  const m = computeMetrics(companies);
  const shown = tier ? companies.filter((c) => c.intel?.fit_tier === tier) : companies;

  return (
    <>
      <section className="metrics">
        <Metric
          label="Prep time per sprint"
          value={`${m.reviewMinutes} min`}
          note={`vs ~${m.manualMinutes} min researching by hand`}
        />
        <Metric label="Research ≤ 7 days old" value={pct(m.freshPct)} note={`${m.researched}/${m.total} accounts researched`} />
        <Metric label="Openers citing a real signal" value={pct(m.verifiedPct)} note="checked in code, not by the AI" />
        <Metric label="Tier A — call this week" value={m.tierA} note={`${pct(m.confidentPct)} with medium/high confidence`} />
      </section>

      <section className="card funnel">
        <h2>Outreach results by tier</h2>
        <p className="muted small">
          Update each account’s status as you work it. If Tier A doesn’t beat Tier C here, the scoring weights need tuning.
        </p>
        <div className="funnel-grid">
          {["A", "B", "C"].map((t) => {
            const f = m.funnel[t];
            return (
              <div key={t} className="funnel-cell">
                <TierBadge tier={t} />
                <div>
                  <div><strong>{f.contacted}</strong>/{f.total} contacted</div>
                  <div className="muted small">
                    Reply {pct(f.replyRate === null ? null : Math.round(f.replyRate * 100))} · Meeting{" "}
                    {pct(f.meetingRate === null ? null : Math.round(f.meetingRate * 100))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="toolbar">
        <nav className="filters" aria-label="Filter by tier">
          {[["", "All"], ["A", "Tier A"], ["B", "Tier B"], ["C", "Tier C"]].map(([t, label]) => (
            <Link key={label} href={t ? `/?tier=${t}` : "/"} className={`filter ${(tier ?? "") === t ? "active" : ""}`}>
              {label}
            </Link>
          ))}
        </nav>
        <a className="btn btn-ghost" href={tableEditorUrl()} target="_blank" rel="noreferrer">
          + Add / remove companies in Supabase
        </a>
      </section>

      {companies.length === 0 ? (
        <section className="card">
          <p>Your watchlist is empty. Add a row to the <code>companies</code> table in Supabase (name + github_org).</p>
        </section>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Fit</th>
                <th>Languages</th>
                <th>Infra & tooling</th>
                <th>Activity</th>
                <th>Status</th>
                <th>Refreshed</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const i = c.intel;
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/company/${c.id}`} className="company-link">{c.name}</Link>
                      <div className="muted small mono">@{c.github_org}</div>
                      {i?.changes?.any && <Chip tone="accent">changed this week</Chip>}
                      {i?.status === "error" && <Chip tone="danger" title={i.error_message}>refresh error</Chip>}
                    </td>
                    <td>
                      <TierBadge tier={i?.fit_tier} score={i?.fit_score} />
                      <div><Confidence level={i?.confidence} /></div>
                    </td>
                    <td className="small">
                      {(i?.top_languages ?? []).slice(0, 3).map((l) => `${l.name} ${Math.round(l.pct)}%`).join(" · ") || "—"}
                    </td>
                    <td>
                      <div className="chips">
                        {(i?.infra_signals ?? []).slice(0, 4).map((s) => <Chip key={s.key}>{s.label}</Chip>)}
                      </div>
                    </td>
                    <td className="small">
                      {i?.activity_level ?? "—"}
                      {i?.activity_detail && (
                        <div className="muted">{i.activity_detail.repos_pushed_90d} repos / 90d</div>
                      )}
                    </td>
                    <td className="small">{STATUS_LABELS[c.outreach_status]}</td>
                    <td className={`small ${isStale(i?.last_refreshed) ? "stale" : "muted"}`}>
                      {timeAgo(i?.last_refreshed)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Metric({ label, value, note }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}

const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);
