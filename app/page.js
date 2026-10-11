import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { computeMetrics, getWatchlist } from "@/lib/data";
import { isConfigured, tableEditorUrl } from "@/lib/supabaseAdmin";
import CopyButton from "./components/CopyButton";
import {
  Avatar, Chip, Confidence, isStale, ScoreMeter, ScoreRing, SetupNeeded, STATUS_LABELS,
  StackedBar, TierPill, timeAgo,
} from "./components/ui";

export default function Home({ searchParams }) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }) {
  await connection();
  if (!isConfigured()) return <SetupNeeded />;

  const { tier } = await searchParams;
  const companies = await getWatchlist();
  const m = computeMetrics(companies);
  const shown = tier ? companies.filter((c) => c.intel?.fit_tier === tier) : companies;
  const callNow = companies
    .filter((c) => c.intel?.fit_tier === "A" && !["won", "lost"].includes(c.outreach_status))
    .slice(0, 3);
  const nextRun = new Date(m.nextRun).toLocaleString("en-GB", {
    weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });

  return (
    <>
      {/* ── Hero: the one number that matters this morning ── */}
      <section className="hero">
        <div className="hero-main">
          <p className="eyebrow">
            <span className="live-dot" aria-hidden /> Research refreshed {timeAgo(m.lastRefresh)} · next run {nextRun} UTC
          </p>
          <h1>
            <span className="hero-figure">{m.tierA}</span>
            <span>
              account{m.tierA === 1 ? "" : "s"} to call this week
              <small>out of {m.total} on your watchlist, ranked by fit for FlowForge</small>
            </span>
          </h1>
          <div className="hero-actions">
            <a className="btn btn-light" href={tableEditorUrl()} target="_blank" rel="noreferrer">
              + Add or remove companies
            </a>
            <a className="btn btn-outline-light" href="#how-scoring-works">How the score works</a>
          </div>
        </div>
        <div className="hero-side">
          <div className="hero-side-label">Watchlist by tier</div>
          <StackedBar
            label="Accounts per tier"
            items={[
              { name: "A · Call", value: m.tiers.A, className: "tierfill-A" },
              { name: "B · Nurture", value: m.tiers.B, className: "tierfill-B" },
              { name: "C · Later", value: m.tiers.C, className: "tierfill-C" },
            ]}
          />
        </div>
      </section>

      {/* ── KPI tiles ── */}
      <section className="kpis">
        <Kpi
          label="Prep time per sprint"
          value={`${m.reviewMinutes} min`}
          delta={`−${m.manualMinutes - m.reviewMinutes} min vs. manual research`}
          good
        />
        <Kpi label="Research under 7 days old" value={pct(m.freshPct)} delta={`${m.researched} of ${m.total} accounts researched`} />
        <Kpi label="Openers citing a real signal" value={pct(m.verifiedPct)} delta="Checked in code, not by the AI" />
        <Kpi label="Medium or high confidence" value={pct(m.confidentPct)} delta={m.errors ? `${m.errors} refresh error${m.errors > 1 ? "s" : ""}` : "No refresh errors"} />
      </section>

      {/* ── Call this week ── */}
      {callNow.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Call this week</h2>
            <span className="muted small">Top Tier A accounts with a ready-to-send first line</span>
          </div>
          <div className="call-grid">
            {callNow.map((c) => (
              <article key={c.id} className="card call-card">
                <header className="call-head">
                  <Avatar org={c.github_org} name={c.name} size={40} />
                  <div className="call-title">
                    <Link href={`/company/${c.id}`} className="company-link">{c.name}</Link>
                    <Confidence level={c.intel.confidence} />
                  </div>
                  <ScoreRing score={c.intel.fit_score} tier="A" size={52} />
                </header>
                <div className="chips">
                  {(c.intel.infra_signals ?? []).slice(0, 4).map((s) => <Chip key={s.key}>{s.label}</Chip>)}
                </div>
                <blockquote className="call-opener">{c.intel.first_line}</blockquote>
                <footer className="call-foot">
                  <CopyButton text={c.intel.first_line} />
                  <Link href={`/company/${c.id}`} className="link-arrow">Full briefing →</Link>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ── Watchlist ── */}
      <section className="section">
        <div className="section-head">
          <h2>Watchlist</h2>
          <nav className="filters" aria-label="Filter by tier">
            {[["", "All", m.total], ["A", "Tier A", m.tiers.A], ["B", "Tier B", m.tiers.B], ["C", "Tier C", m.tiers.C]].map(([t, label, n]) => (
              <Link key={label} href={t ? `/?tier=${t}` : "/"} className={`filter ${(tier ?? "") === t ? "active" : ""}`} scroll={false}>
                {label} <span className="filter-count">{n}</span>
              </Link>
            ))}
          </nav>
        </div>

        {companies.length === 0 ? (
          <div className="card empty">
            <p>Your watchlist is empty. Add a row to the <code>companies</code> table in Supabase (name + github_org).</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="card empty"><p>No accounts in this tier yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Fit score</th>
                  <th>Main languages</th>
                  <th>Infra & tooling</th>
                  <th>Activity</th>
                  <th>Outreach</th>
                  <th>Refreshed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const i = c.intel;
                  const infra = i?.infra_signals ?? [];
                  return (
                    <tr key={c.id}>
                      <td data-label="Company">
                        <div className="company-cell">
                          <Avatar org={c.github_org} name={c.name} />
                          <div>
                            <Link href={`/company/${c.id}`} className="company-link">{c.name}</Link>
                            <div className="muted small mono">@{c.github_org}</div>
                            <div className="row-badges">
                              {i?.changes?.any && <Chip tone="accent">Changed this week</Chip>}
                              {i?.status === "error" && <Chip tone="danger" title={i.error_message}>Refresh error</Chip>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Fit score">
                        <ScoreMeter score={i?.fit_score} tier={i?.fit_tier} />
                        <div className="fit-sub">
                          <TierPill tier={i?.fit_tier} />
                          <Confidence level={i?.confidence} />
                        </div>
                      </td>
                      <td data-label="Languages" className="small">
                        {(i?.top_languages ?? []).slice(0, 3).map((l) => (
                          <div key={l.name} className="lang-line">
                            <span>{l.name}</span>
                            <span className="muted tabular">{Math.round(l.pct)}%</span>
                          </div>
                        ))}
                        {!i?.top_languages?.length && "—"}
                      </td>
                      <td data-label="Infra & tooling">
                        <div className="chips">
                          {infra.slice(0, 4).map((s) => <Chip key={s.key}>{s.label}</Chip>)}
                          {infra.length > 4 && <Chip tone="muted">+{infra.length - 4}</Chip>}
                        </div>
                      </td>
                      <td data-label="Activity" className="small">
                        <span className={`activity act-${(i?.activity_level ?? "none").toLowerCase()}`}>{i?.activity_level ?? "—"}</span>
                        {i?.activity_detail && (
                          <div className="muted">{i.activity_detail.repos_pushed_90d} repos in 90 days</div>
                        )}
                      </td>
                      <td data-label="Outreach">
                        <span className={`status status-${c.outreach_status}`}>{STATUS_LABELS[c.outreach_status]}</span>
                      </td>
                      <td data-label="Refreshed" className={`small ${isStale(i?.last_refreshed) ? "stale" : "muted"}`}>
                        {timeAgo(i?.last_refreshed)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Outcomes + rubric ── */}
      <section className="section grid-2-even">
        <div className="card">
          <div className="section-head tight">
            <h2>Outreach results by tier</h2>
          </div>
          <p className="muted small">
            Set each account’s status as you work it. If Tier A doesn’t beat Tier C here, the scoring weights need tuning.
          </p>
          <table className="mini-table">
            <thead>
              <tr><th>Tier</th><th>Contacted</th><th>Reply rate</th><th>Meeting rate</th></tr>
            </thead>
            <tbody>
              {["A", "B", "C"].map((t) => {
                const f = m.funnel[t];
                return (
                  <tr key={t}>
                    <td><TierPill tier={t} /></td>
                    <td className="tabular">{f.contacted} / {f.total}</td>
                    <td><Rate value={f.replyRate} /></td>
                    <td><Rate value={f.meetingRate} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card" id="how-scoring-works">
          <div className="section-head tight">
            <h2>How the fit score works</h2>
          </div>
          <p className="muted small">Computed in code from live evidence, out of 100. Gemini never sets the score.</p>
          <ul className="rubric">
            {[
              ["Language fit", 25, "Share of code in Go, TypeScript, Python, Java, Kotlin, Rust"],
              ["Cloud & infra fit", 25, "Kubernetes / Docker, AWS / GCP, Terraform"],
              ["Microservices signal", 15, "Service repos, gRPC, Bazel / Nx / Turborepo"],
              ["Build velocity", 15, "Repos pushed in the last 90 days"],
              ["CI pain signal", 10, "CI workflow density, build-time pain in job posts"],
              ["Buying intent", 10, "Open platform / DevEx / SRE roles"],
            ].map(([name, max, how]) => (
              <li key={name}>
                <div className="rubric-row"><span>{name}</span><span className="mono">{max}</span></div>
                <div className="meter thin"><span className="meter-fill fill-A" style={{ width: `${(max / 25) * 100}%` }} /></div>
                <div className="muted small">{how}</div>
              </li>
            ))}
          </ul>
          <p className="small">
            <TierPill tier="A" /> 75+ &nbsp; <TierPill tier="B" /> 50–74 &nbsp; <TierPill tier="C" /> under 50
          </p>
        </div>
      </section>
    </>
  );
}

function Kpi({ label, value, delta, good }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className={`kpi-delta ${good ? "good" : ""}`}>{delta}</div>
    </div>
  );
}

function Rate({ value }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const p = Math.round(value * 100);
  return (
    <span className="rate">
      <span className="meter thin"><span className="meter-fill fill-A" style={{ width: `${p}%` }} /></span>
      <span className="tabular">{p}%</span>
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <section className="hero skeleton-hero" aria-busy>
        <div className="hero-main">
          <p className="eyebrow">Loading live research…</p>
          <h1><span className="hero-figure">·</span></h1>
        </div>
      </section>
      <section className="kpis">
        {[0, 1, 2, 3].map((k) => <div key={k} className="kpi skeleton" />)}
      </section>
    </>
  );
}

const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);
