import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getCompany } from "@/lib/data";
import { isConfigured } from "@/lib/supabaseAdmin";
import { techLabel } from "@/lib/tech";
import { toBundle } from "@/lib/evidence";
import AutoRefresh from "@/app/components/AutoRefresh";
import EditableOutput from "@/app/components/EditableOutput";
import RefreshButton from "@/app/components/RefreshButton";
import StatusSelect from "@/app/components/StatusSelect";
import VersionRestore from "@/app/components/VersionRestore";
import { RemoveButton, RestoreButton } from "@/app/components/WatchlistButtons";
import {
  Avatar, CATEGORY_LABELS, Chip, ConfidenceBadge, EVIDENCE_STATUS_LABELS, formatDate, FreshnessBadge,
  ResearchStatus, ScoreRing, SetupNeeded, SOURCE_TYPE_LABELS, TIER_TEXT, timeAgo,
} from "@/app/components/ui";

// "Refresh now" runs the full pipeline as a server action from this page.
export const maxDuration = 300;

const RANK = { high: 0, medium: 1, low: 2 };
const ORIGIN_LABEL = {
  ai_refresh: "Weekly research",
  ai_regenerate: "Rewritten",
  ai_feedback: "Rewritten with your note",
  edited: "Edited by you",
  restored: "Restored",
};

export default function CompanyPage({ params, searchParams }) {
  return (
    <>
      <Link href="/watchlist" className="back">← Watchlist</Link>
      <Suspense fallback={<p className="muted">Loading report…</p>}>
        <CompanyReport params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** Group evidence by signal for the snapshot: one row per language/tool, strongest confidence wins. */
function snapshot(evidence, category, label = (k) => k) {
  const groups = new Map();
  for (const e of evidence.filter((x) => x.category === category && x.signal_key)) {
    const key = String(e.signal_key).toLowerCase();
    const g = groups.get(key) ?? { key, name: label(e.signal_key), items: [] };
    g.items.push(e);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, best: [...g.items].sort((a, b) => RANK[a.confidence] - RANK[b.confidence])[0] }))
    .map((g) => ({ ...g, confidence: g.best.confidence }))
    .sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || b.items.length - a.items.length);
}

async function CompanyReport({ params, searchParams }) {
  await connection();
  if (!isConfigured()) return <SetupNeeded />;

  const [{ id }, { tab = "overview" }] = await Promise.all([params, searchParams]);
  const c = await getCompany(id);
  if (!c) notFound();
  const i = c.intel;
  const ev = c.evidence;
  const busy = ["queued", "researching"].includes(c.research_status);
  const gaps = i?.research_gaps ?? [];
  const base = `/company/${c.id}`;
  const TABS = [
    ["overview", "Overview"],
    ["evidence", `Evidence${ev.length ? ` · ${ev.length}` : ""}`],
    ["score", "Fit score"],
    ["history", "History"],
  ];

  return (
    <article className="report">
      <AutoRefresh active={busy} />

      {/* ── Header ── */}
      <header className="report-head">
        <div className="report-id">
          <Avatar org={c.github_org} name={c.name} size={56} />
          <div>
            <h1>{c.name}</h1>
            <div className="report-links small">
              {c.website && <a href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, "")}</a>}
              {c.github_org && <a href={`https://github.com/${c.github_org}`} target="_blank" rel="noreferrer">GitHub</a>}
              <ResearchStatus status={c.research_status} />
              <span className="muted">updated {timeAgo(i?.last_refreshed)}</span>
            </div>
          </div>
        </div>
        <div className="report-actions">
          {i?.fit_score != null && (
            <div className="report-score" title="How well this company fits FlowForge, computed from the evidence">
              <ScoreRing score={i.fit_score} tier={i.fit_tier} size={56} />
              <div>
                <div className="score-title">{TIER_TEXT[i.fit_tier]}</div>
                <div className="muted small">Fit for FlowForge</div>
              </div>
            </div>
          )}
          <StatusSelect companyId={c.id} value={c.outreach_status} />
          <RefreshButton companyId={c.id} />
        </div>
      </header>

      {!c.active && (
        <div className="banner warn">
          Removed from the watchlist; it’s no longer refreshed. <RestoreButton companyId={c.id} />
        </div>
      )}
      {busy && (
        <div className="banner info">
          <span className="spinner" aria-hidden /> Researching: reading public code, job posts and engineering articles. This page updates by itself (about a minute).
        </div>
      )}
      {i?.status === "error" && <div className="banner bad">The latest refresh failed ({i.error_message}). Showing the last good report.</div>}

      <nav className="tabs" aria-label="Report sections">
        {TABS.map(([key, label]) => (
          <Link key={key} href={key === "overview" ? base : `${base}?tab=${key}`} scroll={false} className={`tab ${tab === key ? "active" : ""}`}>
            {label}
          </Link>
        ))}
      </nav>

      {!i?.summary ? (
        <section className="card empty">
          <p>{busy ? "Your report will appear here in about a minute." : "No research yet. Click Refresh now to start."}</p>
        </section>
      ) : tab === "evidence" ? (
        <EvidenceTab ev={ev} gaps={gaps} />
      ) : tab === "score" ? (
        <ScoreTab i={i} history={c.history} />
      ) : tab === "history" ? (
        <HistoryTab c={c} i={i} />
      ) : (
        <OverviewTab c={c} i={i} ev={ev} gaps={gaps} base={base} />
      )}
    </article>
  );
}

// ─────────────────────────── Overview: the 10% Nikhil needs before a call ───────────────────────────

function OverviewTab({ c, i, ev, gaps, base }) {
  const refToId = Object.fromEntries(toBundle(ev).map((e) => [e.ref, e.id]));
  const langs = snapshot(ev, "language").slice(0, 4);
  const infra = snapshot(ev, "infrastructure", techLabel).slice(0, 6);
  const activity = ev
    .filter((e) => ["activity", "sales_relevance"].includes(e.category))
    .sort((a, b) => RANK[a.confidence] - RANK[b.confidence])
    .slice(0, 3);
  const cite = i.opener_evidence?.[0];

  return (
    <div className="overview">
      <section className="card line-card">
        <div className="label">Your opening line</div>
        {i.first_line ? (
          <EditableOutput companyId={c.id} type="first_line" content={i.first_line} origin={i.first_line_origin}>
            <blockquote className="line-text">{i.first_line}</blockquote>
          </EditableOutput>
        ) : (
          <p className="muted">Not enough strong public evidence for a personal opening line yet.</p>
        )}
        {cite && i.opener_verified && (
          <p className="line-source small">
            <span className="check" aria-hidden>✓</span> Based on: {cite.claim}{" "}
            {cite.source_url && <a href={cite.source_url} target="_blank" rel="noreferrer">Source ↗</a>}
          </p>
        )}
        {!i.opener_verified && i.first_line && (
          <p className="line-source small warn-text">
            {i.first_line_origin === "edited" ? "Edited by you, not checked against the evidence." : "Couldn’t confirm this line cites strong evidence."}
          </p>
        )}
      </section>

      <div className="overview-grid">
        <section className="card">
          <h2>What to know</h2>
          <EditableOutput companyId={c.id} type="summary" content={i.summary} origin={i.summary_origin}>
            <div className="prose">
              {i.summary.split(/\n\s*\n/).map((p, k) => <p key={k}>{withRefs(p, refToId, base)}</p>)}
            </div>
          </EditableOutput>
          {i.talking_points?.length > 0 && (
            <details className="questions">
              <summary>3 questions to ask on the call</summary>
              <ol className="points">{i.talking_points.map((t, k) => <li key={k}>{t}</li>)}</ol>
            </details>
          )}
        </section>

        <aside className="card stack-card">
          <h2>Tech stack at a glance</h2>
          <StackGroup title="Languages" items={langs} base={base} />
          <StackGroup title="Cloud & tools" items={infra} base={base} />
          <div className="stack-group">
            <div className="label">Activity</div>
            {activity.length ? (
              <ul className="activity-list">
                {activity.map((e) => <li key={e.id} className="small">{e.claim}</li>)}
              </ul>
            ) : <p className="muted small">Not enough public evidence.</p>}
          </div>
          <Link href={`${base}?tab=evidence`} className="small link-arrow">See all {ev.length} findings and sources →</Link>
        </aside>
      </div>

      {gaps.length > 0 && (
        <Link href={`${base}?tab=evidence#gaps`} className="gap-note">
          <span aria-hidden>ⓘ</span> {gaps.length} thing{gaps.length > 1 ? "s" : ""} we couldn’t verify publicly, e.g. {gaps[0].detail.replace(/\.$/, "").toLowerCase()}. <span className="link-arrow">Details →</span>
        </Link>
      )}
    </div>
  );
}

function StackGroup({ title, items, base }) {
  return (
    <div className="stack-group">
      <div className="label">{title}</div>
      {items.length ? (
        <div className="stack-chips">
          {items.map((g) => (
            <Link key={g.key} href={`${base}?tab=evidence#ev-${g.best.id}`} className={`stack-chip conf-${g.confidence}`} title={`${g.confidence} confidence · ${g.items.length} source${g.items.length > 1 ? "s" : ""}`}>
              <i aria-hidden />{g.name}
            </Link>
          ))}
        </div>
      ) : <p className="muted small">Not enough public evidence.</p>}
    </div>
  );
}

/** Turn "(E3, E7)" citations into small links to the evidence rows. */
function withRefs(text, refToId, base) {
  return text.split(/\b(E\d{1,3})\b/).map((part, k) =>
    refToId[part] ? <Link key={k} href={`${base}?tab=evidence#ev-${refToId[part]}`} className="ref" title="See the source">{part}</Link> : part
  );
}

// ─────────────────────────── Evidence ───────────────────────────

function EvidenceTab({ ev, gaps }) {
  const byCategory = Object.keys(CATEGORY_LABELS)
    .map((cat) => [cat, ev.filter((e) => e.category === cat).sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || a.source_tier - b.source_tier)])
    .filter(([, list]) => list.length);
  return (
    <div className="stack-sections">
      <section className="card">
        <h2>How to read this</h2>
        <p className="muted small">
          Every finding comes from a public source and is rated by fixed rules, not by the AI: <b>Tier 1</b> sources are the
          company’s own code, job posts and blog; <b>Tier 2</b> talks and news; <b>Tier 3</b> third-party articles. Confidence rises
          when independent sources agree and drops when evidence is old.
        </p>
      </section>

      {byCategory.map(([cat, list]) => (
        <section key={cat} className="card" id={`ev-${cat}`}>
          <h2>{CATEGORY_LABELS[cat]} <span className="muted small">{list.length}</span></h2>
          <ul className="ev-list">
            {list.map((e) => (
              <li key={e.id} id={`ev-${e.id}`} className="ev-item">
                <div className="ev-top">
                  <span className="ev-claim">{e.claim}</span>
                  <ConfidenceBadge level={e.confidence} />
                </div>
                {e.excerpt && <div className="muted small">{e.excerpt}</div>}
                <div className="ev-meta small">
                  {e.source_url ? <a href={e.source_url} target="_blank" rel="noreferrer">{e.source_title ?? "Source"} ↗</a> : <span>{e.source_title}</span>}
                  <span className="muted">{SOURCE_TYPE_LABELS[e.source_type]} · Tier {e.source_tier}</span>
                  <span className="muted">{EVIDENCE_STATUS_LABELS[e.evidence_status]}</span>
                  <span className="muted">published {formatDate(e.source_date)} · checked {formatDate(e.observed_at)}</span>
                  <FreshnessBadge value={e.freshness} />
                </div>
                {e.caveat && <div className="caveat small">{e.caveat}</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="card" id="gaps">
        <h2>What we couldn’t verify</h2>
        {gaps.length ? (
          <ul className="gaps">{gaps.map((g, k) => <li key={k}><b>{g.area}:</b> {g.detail}</li>)}</ul>
        ) : <p className="muted small">Every source type returned evidence this week.</p>}
        <p className="muted small">A gap means it isn’t visible publicly, not that the company doesn’t use it. Professional-network pages aren’t scraped.</p>
      </section>
    </div>
  );
}

// ─────────────────────────── Fit score ───────────────────────────

function ScoreTab({ i, history }) {
  return (
    <section className="card">
      <div className="score-hero">
        <ScoreRing score={i.fit_score} tier={i.fit_tier} size={96} />
        <div>
          <h2>{TIER_TEXT[i.fit_tier]} · {i.fit_score}/100</h2>
          <p className="muted small">How well this company matches FlowForge’s ideal customer, computed in code from the evidence. It describes fit, not whether they need or will buy the product.</p>
        </div>
      </div>
      <ul className="breakdown two-col">
        {(i.score_breakdown ?? []).map((b) => (
          <li key={b.key}>
            <div className="breakdown-row"><span>{b.label}</span><span className="mono">{b.points}<span className="muted">/{b.max}</span></span></div>
            <div className="meter"><span className={`meter-fill fill-${i.fit_tier}`} style={{ width: `${(b.points / b.max) * 100}%` }} /></div>
            <div className="muted small">{b.evidence.join(" · ")}</div>
          </li>
        ))}
      </ul>
      {history.length > 1 && <p className="muted small">Score over time: {history.map((h) => h.fit_score).join(" → ")}</p>}
    </section>
  );
}

// ─────────────────────────── History ───────────────────────────

function HistoryTab({ c, i }) {
  return (
    <div className="stack-sections">
      {i.changes?.any && (
        <section className="card">
          <h2>What changed since {timeAgo(i.changes.since)}</h2>
          <div className="chips">
            {i.changes.score_delta !== 0 && <Chip tone="accent">Score {i.changes.score_delta > 0 ? "+" : ""}{i.changes.score_delta}</Chip>}
            {i.changes.new_tools.map((t) => <Chip key={`n${t}`} tone="accent">+ {t}</Chip>)}
            {i.changes.dropped_tools.map((t) => <Chip key={`d${t}`} tone="muted">− {t}</Chip>)}
            {i.changes.new_languages.map((t) => <Chip key={`l${t}`} tone="accent">+ {t}</Chip>)}
          </div>
        </section>
      )}
      <section className="card">
        <h2>Versions of the summary and opening line</h2>
        <p className="muted small">Every weekly report, rewrite and edit is kept. Restoring a version never changes the evidence.</p>
        <ul className="versions">
          {c.versions.map((v) => (
            <li key={v.id}>
              <div className="version-head small">
                <b>{v.output_type === "summary" ? "Summary" : "Opening line"}</b>
                <span className="muted">{ORIGIN_LABEL[v.origin]} · {timeAgo(v.created_at)}</span>
                <VersionRestore companyId={c.id} versionId={v.id} />
              </div>
              {v.feedback && <div className="muted small">Your note: “{v.feedback}”</div>}
              <div className="version-body small">{v.content.length > 240 ? `${v.content.slice(0, 240)}…` : v.content}</div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Remove from watchlist</h2>
        <p className="muted small">Stops the weekly refresh. The research history is kept and you can restore it any time.</p>
        {c.active ? <RemoveButton companyId={c.id} name={c.name} redirectHome /> : <RestoreButton companyId={c.id} />}
      </section>
    </div>
  );
}
