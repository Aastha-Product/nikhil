import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { computeMetrics, getRecentRuns, getWatchlist } from "@/lib/data";
import { isConfigured } from "@/lib/supabaseAdmin";
import AddCompanyForm from "./components/AddCompanyForm";
import AutoRefresh from "./components/AutoRefresh";
import CopyButton from "./components/CopyButton";
import { RemoveButton, RestoreButton } from "./components/WatchlistButtons";
import {
  Avatar, Chip, Confidence, isStale, ResearchStatus, ScoreMeter, ScoreRing, SetupNeeded, STATUS_LABELS,
  StackedBar, TierPill, timeAgo,
} from "./components/ui";

// Adding a company starts research in the background (after()) from this page's server action.
export const maxDuration = 300;

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
  const [{ active: companies, removed }, runs] = await Promise.all([getWatchlist(), getRecentRuns(5)]);
  const m = computeMetrics(companies);
  const shown = tier ? companies.filter((c) => c.intel?.fit_tier === tier) : companies;
  const callNow = companies
    .filter((c) => c.intel?.fit_tier === "A" && c.intel?.first_line && !["won", "lost"].includes(c.outreach_status))
    .slice(0, 3);
  const nextRun = new Date(m.nextRun).toLocaleString("en-GB", {
    weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });

  return (
    <>
      <AutoRefresh active={m.inProgress > 0} />

      {/* ── Hero ── */}
      <section className="hero">
        <div className="hero-main">
          <p className="eyebrow">
            <span className="live-dot" aria-hidden /> Research refreshed {timeAgo(m.lastRefresh)} · next automatic check {nextRun} UTC
            {m.inProgress > 0 && <> · <strong>{m.inProgress} researching now</strong></>}
          </p>
          <h1>
            <span className="hero-figure">{m.tierA}</span>
            <span>
              account{m.tierA === 1 ? "" : "s"} worth calling this week
              <small>out of {m.total} on your watchlist · every finding links to its public source</small>
            </span>
          </h1>
          <div className="hero-actions">
            <a className="btn btn-light" href="#watchlist">Open watchlist</a>
            <a className="btn btn-outline-light" href="#how-it-works">How research works</a>
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
        <Kpi label="Prep time per sprint" value={`${m.reviewMinutes} min`} delta={`−${m.manualMinutes - m.reviewMinutes} min vs. manual research`} good />
        <Kpi label="Research under 7 days old" value={pct(m.freshPct)} delta={`${m.researched} of ${m.total} accounts researched`} />
        <Kpi label="Openers backed by evidence" value={pct(m.verifiedPct)} delta="Cites a high/medium finding, checked in code" />
        <Kpi label="Findings with a source link" value={pct(m.linkedPct)} delta={`${m.evidenceTotal} findings · ${pct(m.strongPct)} high or medium confidence`} />
      </section>

      {/* ── Call this week ── */}
      {callNow.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Worth calling this week</h2>
            <span className="muted small">Suggested first lines; nothing is sent automatically</span>
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
                {c.intel.opener_verified && c.intel.opener_evidence?.[0] && (
                  <div className="cite small">
                    ✓ Based on: <a href={c.intel.opener_evidence[0].source_url} target="_blank" rel="noreferrer">{c.intel.opener_evidence[0].source_title}</a>
                  </div>
                )}
                <footer className="call-foot">
                  <CopyButton text={c.intel.first_line} />
                  <Link href={`/company/${c.id}`} className="link-arrow">Full report →</Link>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ── Watchlist ── */}
      <section className="section" id="watchlist">
        <div className="section-head">
          <h2>Watchlist</h2>
          <div className="head-actions">
            <nav className="filters" aria-label="Filter by tier">
              {[["", "All", m.total], ["A", "Tier A", m.tiers.A], ["B", "Tier B", m.tiers.B], ["C", "Tier C", m.tiers.C]].map(([t, label, n]) => (
                <Link key={label} href={t ? `/?tier=${t}#watchlist` : "/#watchlist"} className={`filter ${(tier ?? "") === t ? "active" : ""}`} scroll={false}>
                  {label} <span className="filter-count">{n}</span>
                </Link>
              ))}
            </nav>
            <AddCompanyForm defaultOpen={companies.length === 0} />
          </div>
        </div>

        {companies.length === 0 ? (
          <div className="card empty"><p>Your watchlist is empty. Add your first company above.</p></div>
        ) : shown.length === 0 ? (
          <div className="card empty"><p>No accounts in this tier yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Fit score</th>
                  <th>Research</th>
                  <th>Infra & tooling</th>
                  <th>Main languages</th>
                  <th>Outreach</th>
                  <th aria-label="Actions" />
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
                            <div className="muted small mono">{c.website ? c.website.replace(/^https?:\/\//, "") : c.github_org ? `@${c.github_org}` : "no website"}</div>
                            <div className="row-badges">
                              {i?.changes?.any && <Chip tone="accent">Changed this week</Chip>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Fit score">
                        {i?.fit_score != null ? (
                          <>
                            <ScoreMeter score={i.fit_score} tier={i.fit_tier} />
                            <div className="fit-sub"><TierPill tier={i.fit_tier} /></div>
                          </>
                        ) : <span className="muted small">Not scored yet</span>}
                      </td>
                      <td data-label="Research" className="small">
                        <ResearchStatus status={c.research_status} />
                        {c.evidence && (
                          <div className="muted">{c.evidence.total} findings · {c.evidence.high} high</div>
                        )}
                        <div className={isStale(i?.last_refreshed) ? "stale" : "muted"}>{i?.last_refreshed ? timeAgo(i.last_refreshed) : "not yet researched"}</div>
                      </td>
                      <td data-label="Infra & tooling">
                        <div className="chips">
                          {infra.slice(0, 4).map((s) => <Chip key={s.key}>{s.label}</Chip>)}
                          {infra.length > 4 && <Chip tone="muted">+{infra.length - 4}</Chip>}
                          {!infra.length && <span className="muted small">—</span>}
                        </div>
                      </td>
                      <td data-label="Languages" className="small">
                        {(i?.top_languages ?? []).slice(0, 3).map((l) => (
                          <div key={l.name} className="lang-line">
                            <span>{l.name}</span>
                            <span className="muted tabular">{Math.round(l.pct)}%</span>
                          </div>
                        ))}
                        {!i?.top_languages?.length && <span className="muted">—</span>}
                      </td>
                      <td data-label="Outreach">
                        <span className={`status status-${c.outreach_status}`}>{STATUS_LABELS[c.outreach_status]}</span>
                      </td>
                      <td data-label="Actions" className="row-actions">
                        <RemoveButton companyId={c.id} name={c.name} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {removed.length > 0 && (
          <details className="removed">
            <summary>Removed companies ({removed.length})</summary>
            <ul>
              {removed.map((c) => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  <RestoreButton companyId={c.id} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ── Refresh runs + outcomes ── */}
      <section className="section grid-2-even">
        <div className="card">
          <div className="section-head tight"><h2>Automatic refresh log</h2></div>
          <p className="muted small">
            A scheduled job checks the watchlist daily and re-researches any company older than 6 days, so every account is refreshed weekly.
            If a source fails, the last good research is kept.
          </p>
          {runs.length ? (
            <table className="mini-table">
              <thead><tr><th>Run</th><th>When</th><th>Result</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{RUN_TRIGGER[r.trigger] ?? r.trigger}</td>
                    <td className="small muted">{timeAgo(r.started_at)}</td>
                    <td className="small">
                      <span className={`rstatus rstatus-${RUN_TONE[r.status]}`}>{RUN_STATUS[r.status]}</span>{" "}
                      {r.status !== "running" && (
                        <span className="muted">
                          {r.companies_succeeded}/{r.companies_attempted} ok{r.companies_failed ? ` · ${r.companies_failed} failed` : ""}{r.companies_deferred ? ` · ${r.companies_deferred} next run` : ""}
                        </span>
                      )}
                      {r.error_summary?.[0] && <div className="stale">{r.error_summary[0].company ? `${r.error_summary[0].company}: ` : ""}{r.error_summary[0].error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">No runs logged yet.</p>
          )}
        </div>

        <div className="card">
          <div className="section-head tight"><h2>Outreach results by tier</h2></div>
          <p className="muted small">Set each account’s status as you work it. If Tier A doesn’t beat Tier C here, the scoring weights need tuning.</p>
          <table className="mini-table">
            <thead><tr><th>Tier</th><th>Contacted</th><th>Reply rate</th><th>Meeting rate</th></tr></thead>
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
      </section>

      {/* ── How it works ── */}
      <section className="section card" id="how-it-works">
        <div className="section-head tight"><h2>How research works</h2></div>
        <ol className="flow">
          <li><b>Collect</b> live public signals: company GitHub repositories, official job postings (Greenhouse, Lever, Ashby), and engineering blogs and talks found with Google Search.</li>
          <li><b>Verify</b> each finding by rule: source tier, how specific it is, how recent it is, and whether other sources agree. Unknowns are listed as research gaps, never guessed.</li>
          <li><b>Generate</b> with Gemini Flash: two paragraphs and one opening line, using only the evidence. Code rejects outputs that name tools with no evidence.</li>
          <li><b>Score</b> fit for FlowForge in code (0–100). Gemini never sets the score.</li>
        </ol>
        <div className="grid-2-even">
          <ul className="rubric">
            {[
              ["Language fit", 25, "Share of code in Go, TypeScript, Python, Java, Kotlin, Rust"],
              ["Cloud & infra fit", 25, "Kubernetes / Docker, AWS / GCP, Terraform"],
              ["Microservices signal", 15, "Service repos, gRPC, Bazel / Nx / Turborepo"],
            ].map(([name, max, how]) => <RubricRow key={name} name={name} max={max} how={how} />)}
          </ul>
          <ul className="rubric">
            {[
              ["Build velocity", 15, "Repos pushed in the last 90 days"],
              ["CI & build activity", 10, "CI workflows; build-focus mentions in job posts"],
              ["Platform / DevEx hiring", 10, "Open platform, DevEx, SRE or infra roles"],
            ].map(([name, max, how]) => <RubricRow key={name} name={name} max={max} how={how} />)}
          </ul>
        </div>
        <p className="small">
          <TierPill tier="A" /> 75+ &nbsp; <TierPill tier="B" /> 50–74 &nbsp; <TierPill tier="C" /> under 50
        </p>
      </section>
    </>
  );
}

const RUN_TRIGGER = { cron: "Scheduled", manual: "Manual (API)", dashboard: "Refresh now", added: "New company" };
const RUN_STATUS = { running: "Running", succeeded: "Succeeded", partial: "Partial", failed: "Failed" };
const RUN_TONE = { running: "pending", succeeded: "ok", partial: "warn", failed: "bad" };

function RubricRow({ name, max, how }) {
  return (
    <li>
      <div className="rubric-row"><span>{name}</span><span className="mono">{max}</span></div>
      <div className="meter thin"><span className="meter-fill fill-A" style={{ width: `${(max / 25) * 100}%` }} /></div>
      <div className="muted small">{how}</div>
    </li>
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
