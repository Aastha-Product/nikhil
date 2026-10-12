import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { computeMetrics, getRecentRuns, getWatchlist } from "@/lib/data";
import { isConfigured } from "@/lib/supabaseAdmin";
import AutoRefresh from "../components/AutoRefresh";
import { RemoveButton, RestoreButton } from "../components/WatchlistButtons";
import { Accordion, Avatar, Chip, ResearchStatus, SetupNeeded, STATUS_LABELS, TierPill, timeAgo } from "../components/ui";

export const metadata = { title: "Watchlist · Tech Stack Scout" };

const VIEWS = [
  ["", "All"],
  ["A", "Worth calling"],
  ["B", "Nurture"],
  ["C", "Later"],
];
const RUN_TRIGGER = { cron: "Scheduled", manual: "Manual", dashboard: "Refresh now", added: "New company" };
const RUN_STATUS = { running: "Running", succeeded: "Done", partial: "Partial", failed: "Failed" };
const RUN_TONE = { running: "pending", succeeded: "ok", partial: "warn", failed: "bad" };
const RUBRIC = [
  ["Language fit", 25, "Share of code in Go, TypeScript, Python, Java, Kotlin, Rust"],
  ["Cloud & infra fit", 25, "Kubernetes / Docker, AWS / GCP, Terraform"],
  ["Microservices signal", 15, "Service repos, gRPC, Bazel / Nx / Turborepo"],
  ["Build velocity", 15, "Repos pushed in the last 90 days"],
  ["CI & build activity", 10, "CI workflows; build-focus mentions in job posts"],
  ["Platform / DevEx hiring", 10, "Open platform, DevEx, SRE or infra roles"],
];

export default function WatchlistPage({ searchParams }) {
  return (
    <Suspense fallback={<p className="muted">Loading your watchlist…</p>}>
      <Watchlist searchParams={searchParams} />
    </Suspense>
  );
}

async function Watchlist({ searchParams }) {
  await connection();
  if (!isConfigured()) return <SetupNeeded />;

  const { tier = "", open = "" } = await searchParams;
  const [{ active: companies, removed }, runs] = await Promise.all([getWatchlist(), getRecentRuns(5)]);
  const m = computeMetrics(companies);
  const shown = tier ? companies.filter((c) => c.intel?.fit_tier === tier) : companies;
  const count = { "": m.total, A: m.tiers.A, B: m.tiers.B, C: m.tiers.C };
  const lastRun = runs[0];
  const contacted = ["A", "B", "C"].reduce((a, t) => a + m.funnel[t].contacted, 0);

  return (
    <>
      <AutoRefresh active={m.inProgress > 0} />

      <header className="page-title">
        <div>
          <h1>Watchlist</h1>
          <p className="muted">
            {m.total} companies · refreshed automatically every week · last update {timeAgo(m.lastRefresh)}
            {m.inProgress > 0 && <> · <strong>{m.inProgress} researching now</strong></>}
          </p>
        </div>
        <Link href="/" className="btn">+ Research a company</Link>
      </header>

      <section className="stat-row">
        <Stat value={m.tierA} label="worth calling this week" tone="accent" />
        <Stat value={`${m.reviewMinutes} min`} label={`to prep all ${m.total}, vs ~${Math.round((m.manualMinutes / 60) * 10) / 10} h by hand`} />
        <Stat value={pct(m.verifiedPct)} label="opening lines backed by a source" />
      </section>

      <nav className="tabs" aria-label="Filter by fit">
        {VIEWS.map(([t, label]) => (
          <Link key={label} href={t ? `/watchlist?tier=${t}` : "/watchlist"} className={`tab ${tier === t ? "active" : ""}`} scroll={false}>
            {label} <span className="tab-count">{count[t]}</span>
          </Link>
        ))}
      </nav>

      {companies.length === 0 ? (
        <div className="card empty">
          <p>No companies yet.</p>
          <Link href="/" className="btn">Research your first company</Link>
        </div>
      ) : shown.length === 0 ? (
        <div className="card empty"><p>No companies in this group yet.</p></div>
      ) : (
        <ul className="rows">
          {shown.map((c) => {
            const i = c.intel;
            const busy = ["queued", "researching"].includes(c.research_status);
            return (
              <li key={c.id} className="row">
                <Link href={`/company/${c.id}`} className="row-link" aria-label={`Open ${c.name}`} />
                <Avatar org={c.github_org} name={c.name} size={40} />
                <div className="row-main">
                  <div className="row-name">{c.name}</div>
                  <div className="muted small">
                    {c.website ? c.website.replace(/^https?:\/\//, "") : c.github_org ? `github.com/${c.github_org}` : "—"}
                  </div>
                </div>
                <div className="row-tools">
                  {(i?.infra_signals ?? []).slice(0, 3).map((s) => <Chip key={s.key}>{s.label}</Chip>)}
                </div>
                <div className="row-fit">
                  {busy || i?.fit_score == null ? (
                    <ResearchStatus status={c.research_status} />
                  ) : (
                    <>
                      <span className={`score-pill tier-${i.fit_tier}`}>{i.fit_score}</span>
                      <TierPill tier={i.fit_tier} />
                    </>
                  )}
                </div>
                <div className="row-meta small muted">
                  {c.outreach_status !== "not_contacted" ? STATUS_LABELS[c.outreach_status] : timeAgo(i?.last_refreshed)}
                </div>
                <span className="row-chevron" aria-hidden>›</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Secondary information: one dropdown each, summary always visible in the header. */}
      <section className="acc-group">
        <Accordion
          id="log"
          open={open === "log"}
          title="Refresh log"
          meta={lastRun ? `Last run: ${RUN_STATUS[lastRun.status].toLowerCase()}, ${timeAgo(lastRun.started_at)}` : "No runs yet"}
        >
          <p className="muted small">Runs daily and re-researches any company older than 6 days, so every account is refreshed weekly. If a source fails, the last good research is kept.</p>
          <ul className="log">
            {runs.map((r) => (
              <li key={r.id}>
                <span className={`rstatus rstatus-${RUN_TONE[r.status]}`}>{RUN_STATUS[r.status]}</span>
                <span className="small">{RUN_TRIGGER[r.trigger] ?? r.trigger} · {timeAgo(r.started_at)}</span>
                {r.status !== "running" && (
                  <span className="small muted">
                    {r.companies_succeeded}/{r.companies_attempted} ok{r.companies_failed ? ` · ${r.companies_failed} failed` : ""}{r.companies_deferred ? ` · ${r.companies_deferred} next run` : ""}
                  </span>
                )}
                {r.error_summary?.[0] && <span className="small warn-text">{r.error_summary[0].company ? `${r.error_summary[0].company}: ` : ""}{r.error_summary[0].error}</span>}
              </li>
            ))}
          </ul>
        </Accordion>

        <Accordion id="outreach" open={open === "outreach"} title="Outreach results" meta={`${contacted} of ${m.total} contacted`}>
          <p className="muted small">Set a status on each company as you work it. Good fits should reply more often than weak ones; if they don’t, the scoring needs tuning.</p>
          <ul className="log">
            {["A", "B", "C"].map((t) => {
              const f = m.funnel[t];
              return (
                <li key={t}>
                  <TierPill tier={t} />
                  <span className="small">{f.contacted}/{f.total} contacted</span>
                  <span className="small muted">reply {rate(f.replyRate)} · meeting {rate(f.meetingRate)}</span>
                </li>
              );
            })}
          </ul>
        </Accordion>

        <Accordion id="scoring" open={open === "scoring"} title="How scoring works" meta="6 criteria, 100 points, computed in code">
          <p className="muted small">
            Every finding comes from a public source and is rated by fixed rules. Gemini Flash only writes the text; it never sets the score.
            The score describes fit with FlowForge, not whether a company needs or will buy it.
          </p>
          <ul className="rubric">
            {RUBRIC.map(([name, max, how]) => (
              <li key={name}>
                <div className="rubric-row"><span>{name}</span><span className="mono">{max}</span></div>
                <div className="meter thin"><span className="meter-fill fill-A" style={{ width: `${(max / 25) * 100}%` }} /></div>
                <div className="muted small">{how}</div>
              </li>
            ))}
          </ul>
          <p className="small"><TierPill tier="A" /> 75+ &nbsp; <TierPill tier="B" /> 50–74 &nbsp; <TierPill tier="C" /> under 50</p>
        </Accordion>

        <Accordion id="manage" open={open === "manage"} title="Manage list" meta={`${companies.length} active${removed.length ? ` · ${removed.length} removed` : ""}`}>
          <p className="muted small">Removing stops the weekly refresh but keeps the history, so you can restore it any time.</p>
          <ul className="log">
            {companies.map((c) => (
              <li key={c.id}>
                <span className="small">{c.name}</span>
                <RemoveButton companyId={c.id} name={c.name} />
              </li>
            ))}
            {removed.map((c) => (
              <li key={c.id}>
                <span className="small muted">{c.name} (removed)</span>
                <RestoreButton companyId={c.id} />
              </li>
            ))}
          </ul>
        </Accordion>
      </section>
    </>
  );
}

function Stat({ value, label, tone }) {
  return (
    <div className={`stat-card ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-big">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}

const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);
const rate = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
