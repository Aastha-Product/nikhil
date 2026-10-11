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
  Avatar, CATEGORY_LABELS, Chip, Confidence, ConfidenceBadge, EVIDENCE_STATUS_LABELS, formatDate, FreshnessBadge,
  ResearchStatus, ScoreRing, SetupNeeded, SOURCE_TYPE_LABELS, TIER_TEXT, timeAgo,
} from "@/app/components/ui";

// "Refresh now" runs the full pipeline as a server action from this page.
export const maxDuration = 300;

const RANK = { high: 0, medium: 1, low: 2 };
const ORIGIN_LABEL = {
  ai_refresh: "Weekly research",
  ai_regenerate: "Regenerated",
  ai_feedback: "Rewritten with feedback",
  edited: "Edited by you",
  restored: "Restored",
};

export default function CompanyPage({ params }) {
  return (
    <>
      <Link href="/" className="back">← Back to watchlist</Link>
      <Suspense fallback={<p className="muted">Loading research…</p>}>
        <CompanyReport params={params} />
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
    .map((g) => {
      const best = [...g.items].sort((a, b) => RANK[a.confidence] - RANK[b.confidence])[0];
      return { ...g, confidence: best.confidence, best, types: [...new Set(g.items.map((i) => i.source_type))] };
    })
    .sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || b.items.length - a.items.length);
}

async function CompanyReport({ params }) {
  await connection();
  if (!isConfigured()) return <SetupNeeded />;

  const { id } = await params;
  const c = await getCompany(id);
  if (!c) notFound();
  const i = c.intel;
  const ev = c.evidence;
  const busy = ["queued", "researching"].includes(c.research_status);

  const langs = snapshot(ev, "language");
  const pctOf = Object.fromEntries((i?.top_languages ?? []).map((l) => [l.name.toLowerCase(), l.pct]));
  const infra = snapshot(ev, "infrastructure", techLabel);
  const activity = ev
    .filter((e) => ["activity", "sales_relevance"].includes(e.category))
    .sort((a, b) => RANK[a.confidence] - RANK[b.confidence]);
  const byCategory = Object.keys(CATEGORY_LABELS)
    .map((cat) => [cat, ev.filter((e) => e.category === cat).sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || a.source_tier - b.source_tier)])
    .filter(([, list]) => list.length);
  const gaps = i?.research_gaps ?? [];
  // The report cites evidence as "E7"; rebuild the same refs (same order as when it was generated) to link them.
  const refToId = Object.fromEntries(toBundle(ev).map((e) => [e.ref, e.id]));

  return (
    <article className="detail">
      <AutoRefresh active={busy} />

      {/* ── 1. Company header ── */}
      <header className="card detail-head">
        <div className="detail-id">
          <Avatar org={c.github_org} name={c.name} size={64} />
          <div>
            <h1>{c.name}</h1>
            <div className="detail-links small">
              {c.website && <a href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, "")}</a>}
              {c.github_org && <a href={`https://github.com/${c.github_org}`} target="_blank" rel="noreferrer" className="mono">github.com/{c.github_org}</a>}
              {c.job_board && <span className="mono muted">{c.job_board}</span>}
            </div>
            <div className="status-line small">
              <ResearchStatus status={c.research_status} />
              <span className="muted">
                Last successful refresh: {i?.last_refreshed ? `${timeAgo(i.last_refreshed)} (${formatDate(i.last_refreshed)})` : "never"}
                {i?.last_attempted && i.last_attempted !== i.last_refreshed && i.status === "error" && ` · last attempt ${timeAgo(i.last_attempted)}`}
              </span>
            </div>
          </div>
        </div>
        {i?.fit_score != null && (
          <div className="detail-score">
            <ScoreRing score={i.fit_score} tier={i.fit_tier} size={88} />
            <div>
              <div className="score-title">Tier {i.fit_tier} · {TIER_TEXT[i.fit_tier]}</div>
              <Confidence level={i.confidence} />
              <div className="muted small">Fit for FlowForge</div>
            </div>
          </div>
        )}
        <div className="detail-actions">
          <label className="field">
            <span className="field-label">Outreach status</span>
            <StatusSelect companyId={c.id} value={c.outreach_status} />
          </label>
          <RefreshButton companyId={c.id} />
          {c.active ? <RemoveButton companyId={c.id} name={c.name} redirectHome /> : <RestoreButton companyId={c.id} />}
        </div>
      </header>

      {!c.active && <div className="card alert">This company was removed from the watchlist, so the weekly job no longer refreshes it.</div>}
      {busy && <div className="card notice">Research is running: collecting public evidence and writing the report. This page updates automatically (about a minute).</div>}
      {i?.status === "error" && (
        <div className="card alert">
          The latest refresh failed: {i.error_message}. {i.summary ? "Showing the last successful report." : ""}
        </div>
      )}
      {c.research_status === "partial" && i?.error_message && <div className="card warn-box">Partial refresh: {i.error_message}. Last known evidence for those sources was kept.</div>}

      {!i?.summary ? (
        <section className="card empty">
          <p>{busy ? "Waiting for the first research run…" : "No research yet. Click Refresh now to collect live evidence."}</p>
        </section>
      ) : (
        <>
          {i.changes?.any && (
            <section className="card changes">
              <div className="label">What changed since {timeAgo(i.changes.since)}</div>
              <div className="chips">
                {i.changes.score_delta !== 0 && <Chip tone="accent">Score {i.changes.score_delta > 0 ? "+" : ""}{i.changes.score_delta}</Chip>}
                {i.changes.new_tools.map((t) => <Chip key={`n${t}`} tone="accent">+ {t}</Chip>)}
                {i.changes.dropped_tools.map((t) => <Chip key={`d${t}`} tone="muted">− {t}</Chip>)}
                {i.changes.new_languages.map((t) => <Chip key={`l${t}`} tone="accent">+ {t}</Chip>)}
              </div>
            </section>
          )}

          {/* ── 2. Quick tech-stack snapshot ── */}
          <section className="card">
            <div className="section-head tight">
              <h2>Quick tech-stack snapshot</h2>
              <span className="muted small">Each item links to its evidence below</span>
            </div>
            <div className="snapshot">
              <SnapshotColumn title="Programming languages" rows={langs.slice(0, 7)} anchor="ev-language" extra={(g) => (pctOf[g.key] ? `${pctOf[g.key]}% of public code` : null)} />
              <SnapshotColumn title="Cloud & infrastructure" rows={infra.slice(0, 9)} anchor="ev-infrastructure" />
              <div className="snap-col">
                <div className="label">Engineering activity</div>
                {activity.length ? (
                  <ul className="snap-list">
                    {activity.slice(0, 6).map((e) => (
                      <li key={e.id}>
                        <a href={`#ev-${e.id}`} className="snap-claim">{e.claim}</a>
                        <ConfidenceBadge level={e.confidence} />
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted small">Not enough public evidence.</p>}
              </div>
            </div>
          </section>

          {/* ── 3. Summary + 4. Opening line ── */}
          <div className="grid-2">
            <section className="card">
              <h2>Engineering context summary</h2>
              <EditableOutput companyId={c.id} type="summary" content={i.summary} origin={i.summary_origin}>
                <div className="prose">
                  {i.summary.split(/\n\s*\n/).map((p, k) => <p key={k}>{withRefs(p, refToId)}</p>)}
                </div>
              </EditableOutput>
              {i.talking_points?.length > 0 && (
                <>
                  <h3>Questions for the call</h3>
                  <ol className="points">
                    {i.talking_points.map((t, k) => <li key={k}>{t}</li>)}
                  </ol>
                </>
              )}
            </section>

            <section className="card opener">
              <div className="label">Suggested opening line · not sent automatically</div>
              {i.first_line ? (
                <EditableOutput companyId={c.id} type="first_line" content={i.first_line} origin={i.first_line_origin}>
                  <blockquote className="opener-text">{i.first_line}</blockquote>
                </EditableOutput>
              ) : (
                <p className="muted">Not enough medium- or high-confidence evidence for a reliable personalized line.</p>
              )}
              <div className={`verify ${i.opener_verified ? "ok" : "warn"}`}>
                {i.opener_verified ? "✓ Anchored to verified evidence:" : i.first_line_origin === "edited" ? "Edited by you — not re-checked against the evidence." : "⚠ Couldn’t confirm this line cites strong evidence."}
              </div>
              {i.opener_evidence?.length > 0 && (
                <ul className="cited">
                  {i.opener_evidence.map((e, k) => (
                    <li key={k}>
                      <ConfidenceBadge level={e.confidence} />
                      <span>{e.claim} {e.source_url && <a href={e.source_url} target="_blank" rel="noreferrer">Source ↗</a>}</span>
                    </li>
                  ))}
                </ul>
              )}
              {i.unsupported_claims?.length > 0 && (
                <p className="form-msg warn">Flagged: the AI mentioned {i.unsupported_claims.join(", ")} without supporting evidence.</p>
              )}
            </section>
          </div>

          {/* ── Fit for FlowForge (sales relevance) ── */}
          <section className="card">
            <div className="section-head tight">
              <h2>Why it scored {i.fit_score} for FlowForge</h2>
              <span className="muted small">Computed in code from the evidence; Gemini never sets the score</span>
            </div>
            <ul className="breakdown two-col">
              {(i.score_breakdown ?? []).map((b) => (
                <li key={b.key}>
                  <div className="breakdown-row">
                    <span>{b.label}</span>
                    <span className="mono">{b.points}<span className="muted">/{b.max}</span></span>
                  </div>
                  <div className="meter"><span className={`meter-fill fill-${i.fit_tier}`} style={{ width: `${(b.points / b.max) * 100}%` }} /></div>
                  <div className="muted small">{b.evidence.join(" · ")}</div>
                </li>
              ))}
            </ul>
            {c.history.length > 1 && <p className="muted small">Score history: {c.history.map((h) => h.fit_score).join(" → ")}</p>}
          </section>

          {/* ── 5. Evidence & sources ── */}
          <section className="card">
            <div className="section-head tight">
              <h2>Evidence & sources</h2>
              <span className="muted small">{ev.length} findings · confidence, freshness and status are assigned by rules, not by the AI</span>
            </div>
            {byCategory.map(([cat, list]) => (
              <div key={cat} className="ev-group" id={`ev-${cat}`}>
                <h3>{CATEGORY_LABELS[cat]} <span className="muted small">({list.length})</span></h3>
                <div className="table-wrap flat">
                  <table className="table ev-table">
                    <thead>
                      <tr><th>Finding</th><th>Source</th><th>Dates</th><th>Status</th><th>Confidence</th></tr>
                    </thead>
                    <tbody>
                      {list.map((e) => (
                        <tr key={e.id} id={`ev-${e.id}`}>
                          <td data-label="Finding">
                            <div className="ev-claim">{e.claim}</div>
                            {e.excerpt && <div className="muted small">{e.excerpt}</div>}
                            {e.caveat && <div className="caveat small">Caveat: {e.caveat}</div>}
                          </td>
                          <td data-label="Source" className="small">
                            {e.source_url ? <a href={e.source_url} target="_blank" rel="noreferrer" className="ev-source">{e.source_title ?? e.source_url}</a> : <span>{e.source_title ?? "—"}</span>}
                            <div className="muted">{SOURCE_TYPE_LABELS[e.source_type]} · Tier {e.source_tier}</div>
                          </td>
                          <td data-label="Dates" className="small">
                            <div>Source: {formatDate(e.source_date)}</div>
                            <div className="muted">Checked: {formatDate(e.observed_at)}</div>
                          </td>
                          <td data-label="Status" className="small">{EVIDENCE_STATUS_LABELS[e.evidence_status]}</td>
                          <td data-label="Confidence">
                            <ConfidenceBadge level={e.confidence} />
                            <div><FreshnessBadge value={e.freshness} /></div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {!ev.length && <p className="muted">No evidence stored yet.</p>}
          </section>

          {/* ── 6. Research gaps ── */}
          <section className="card">
            <h2>Research gaps</h2>
            {gaps.length ? (
              <ul className="gaps">
                {gaps.map((g, k) => (
                  <li key={k}><strong>{g.area}:</strong> {g.detail}</li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No gaps: every source type returned evidence this run.</p>
            )}
            <p className="muted small">
              Absence of evidence isn’t evidence of absence: a gap means we couldn’t verify it publicly, not that the company doesn’t use it.
              Professional-network pages aren’t scraped; hiring evidence comes from official job boards.
            </p>
          </section>

          {/* ── 7. Version history ── */}
          {c.versions.length > 0 && (
            <details className="card versions">
              <summary><h2>Version history ({c.versions.length})</h2></summary>
              <ul>
                {c.versions.map((v) => (
                  <li key={v.id}>
                    <div className="version-head small">
                      <strong>{v.output_type === "summary" ? "Summary" : "Opening line"}</strong>
                      <span className="muted">{ORIGIN_LABEL[v.origin]} · {timeAgo(v.created_at)}</span>
                      <VersionRestore companyId={c.id} versionId={v.id} />
                    </div>
                    {v.feedback && <div className="muted small">Feedback: “{v.feedback}”</div>}
                    <div className="version-body small">{v.content.length > 220 ? `${v.content.slice(0, 220)}…` : v.content}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {c.notes && (
        <section className="card">
          <div className="label">Your notes</div>
          <p>{c.notes}</p>
        </section>
      )}
    </article>
  );
}

/** Turn "(E3, E7)" citations into links to the evidence rows. */
function withRefs(text, refToId) {
  return text.split(/\b(E\d{1,3})\b/).map((part, k) =>
    refToId[part] ? <a key={k} href={`#ev-${refToId[part]}`} className="ref" title="Jump to this evidence">{part}</a> : part
  );
}

function SnapshotColumn({ title, rows, anchor, extra }) {
  return (
    <div className="snap-col">
      <div className="label">{title}</div>
      {rows.length ? (
        <ul className="snap-list">
          {rows.map((g) => (
            <li key={g.key}>
              <a href={`#ev-${g.best.id}`} className="snap-name">{g.name}</a>
              <span className="muted small">
                {extra?.(g) ?? `${g.items.length} source${g.items.length > 1 ? "s" : ""}`}
              </span>
              <ConfidenceBadge level={g.confidence} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Not enough public evidence.</p>
      )}
      <a href={`#${anchor}`} className="small">All evidence →</a>
    </div>
  );
}
