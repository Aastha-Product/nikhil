import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getCompany } from "@/lib/data";
import { isConfigured } from "@/lib/supabaseAdmin";
import { techGroup, techLabel } from "@/lib/tech";
import CopyButton from "@/app/components/CopyButton";
import RefreshButton from "@/app/components/RefreshButton";
import StatusSelect from "@/app/components/StatusSelect";
import {
  Avatar, Chip, Confidence, isStale, ScoreRing, SetupNeeded, SourceTags, StackedBar,
  TIER_TEXT, timeAgo,
} from "@/app/components/ui";

// "Refresh now" runs the full pipeline as a server action from this page.
export const maxDuration = 120;

const GROUPS = [
  ["cloud", "Cloud"],
  ["runtime", "Runtime"],
  ["iac", "Infrastructure as code"],
  ["arch", "Architecture"],
  ["build", "Build & monorepo"],
  ["ci", "CI / CD"],
  ["observability", "Observability"],
];

export default function CompanyPage({ params }) {
  return (
    <>
      <Link href="/" className="back">← Back to watchlist</Link>
      <Suspense fallback={<p className="muted">Loading research…</p>}>
        <CompanyDetail params={params} />
      </Suspense>
    </>
  );
}

async function CompanyDetail({ params }) {
  await connection();
  if (!isConfigured()) return <SetupNeeded />;

  const { id } = await params;
  const c = await getCompany(id);
  if (!c) notFound();
  const i = c.intel;

  const langs = i?.top_languages ?? [];
  const top = langs.slice(0, 6);
  const other = Math.max(0, 100 - top.reduce((a, l) => a + l.pct, 0));
  const langItems = [
    ...top.map((l) => ({ name: l.name, value: l.pct, display: `${l.pct}%` })),
    ...(other >= 1 ? [{ name: "Other", value: other, display: `${Math.round(other)}%`, className: "cat-other" }] : []),
  ];

  return (
    <article className="detail">
      {/* ── Header ── */}
      <header className="card detail-head">
        <div className="detail-id">
          <Avatar org={c.github_org} name={c.name} size={64} />
          <div>
            <h1>{c.name}</h1>
            <div className="detail-links small">
              <a href={`https://github.com/${c.github_org}`} target="_blank" rel="noreferrer" className="mono">github.com/{c.github_org}</a>
              {c.website && <a href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, "")}</a>}
            </div>
            <div className={`small ${isStale(i?.last_refreshed) ? "stale" : "muted"}`}>
              <span className="live-dot" aria-hidden /> Research refreshed {timeAgo(i?.last_refreshed)}
            </div>
          </div>
        </div>
        {i?.fit_score != null && (
          <div className="detail-score">
            <ScoreRing score={i.fit_score} tier={i.fit_tier} size={88} />
            <div>
              <div className="score-title">Tier {i.fit_tier} · {TIER_TEXT[i.fit_tier]}</div>
              <Confidence level={i.confidence} />
            </div>
          </div>
        )}
        <div className="detail-actions">
          <label className="field">
            <span className="field-label">Outreach status</span>
            <StatusSelect companyId={c.id} value={c.outreach_status} />
          </label>
          <RefreshButton companyId={c.id} />
        </div>
      </header>

      {i?.status === "error" && (
        <div className="card alert">
          Last refresh failed: {i.error_message}
          {i.summary ? " Showing the previous successful research." : ""}
        </div>
      )}

      {!i?.summary ? (
        <section className="card empty">
          <p>No research yet. Click <strong>Refresh now</strong> to pull live data (takes about 30 seconds).</p>
        </section>
      ) : (
        <>
          {/* ── Opener ── */}
          <section className="card opener">
            <div className="label">Suggested first line</div>
            <blockquote className="opener-text">{i.first_line}</blockquote>
            <div className="opener-foot">
              <span className={`verify ${i.opener_verified ? "ok" : "warn"}`}>
                {i.opener_verified ? "✓ Cites a real signal:" : "⚠ Couldn’t verify the reference:"} <strong>{i.opener_reference}</strong>
              </span>
              <CopyButton text={i.first_line} />
            </div>
          </section>

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

          {/* ── Briefing + score ── */}
          <div className="grid-2">
            <section className="card">
              <h2>Engineering briefing</h2>
              <div className="prose">
                {i.summary.split(/\n\s*\n/).map((p, k) => <p key={k}>{p}</p>)}
              </div>
              <h3>Questions for the call</h3>
              <ol className="points">
                {(i.talking_points ?? []).map((t, k) => <li key={k}>{t}</li>)}
              </ol>
            </section>

            <section className="card">
              <h2>Why it scored {i.fit_score}</h2>
              <ul className="breakdown">
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
              {c.history.length > 1 && (
                <p className="muted small">Score history: {c.history.map((h) => h.fit_score).join(" → ")}</p>
              )}
            </section>
          </div>

          {/* ── Stack ── */}
          <div className="grid-2">
            <section className="card">
              <h2>Languages</h2>
              {langItems.length ? <StackedBar items={langItems} label="Share of code by language" /> : <p className="muted">No public code found.</p>}
              <p className="muted small">By bytes across their most recently active public repos.</p>
            </section>

            <section className="card">
              <h2>Build activity <span className={`activity act-${(i.activity_level ?? "none").toLowerCase()}`}>{i.activity_level}</span></h2>
              <div className="stat-grid">
                <Stat value={i.activity_detail?.repos_pushed_30d} label="repos pushed, 30 days" />
                <Stat value={i.activity_detail?.repos_pushed_90d} label="repos pushed, 90 days" />
                <Stat value={i.activity_detail?.active_repos} label="active public repos" />
                <Stat value={timeAgo(i.activity_detail?.last_push)} label="last push" />
              </div>
            </section>
          </div>

          <section className="card">
            <h2>Infrastructure & tooling</h2>
            <div className="infra-groups">
              {GROUPS.map(([g, title]) => {
                const items = (i.infra_signals ?? []).filter((s) => techGroup(s.key) === g);
                if (!items.length) return null;
                return (
                  <div key={g} className="infra-group">
                    <div className="label">{title}</div>
                    <ul className="infra">
                      {items.map((s) => (
                        <li key={s.key}>
                          <div className="infra-row">
                            <strong>{s.label}</strong>
                            <SourceTags sources={s.sources} />
                          </div>
                          <div className="muted small">{s.evidence[0]}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Evidence ── */}
          <div className="grid-3">
            <section className="card">
              <h2>Notable repos</h2>
              <ul className="links">
                {(i.notable_repos ?? []).map((r) => (
                  <li key={r.name}>
                    <a href={r.url} target="_blank" rel="noreferrer" className="mono">{r.name}</a>
                    <span className="muted small"> ★ {r.stars.toLocaleString()} · {r.language ?? "—"}</span>
                    {r.description && <div className="muted small clamp-2">{r.description}</div>}
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h2>Hiring signals</h2>
              {i.hiring_signals?.board ? (
                <>
                  <div className="stat-inline">
                    <span className="stat-value">{i.hiring_signals.total_eng_roles}</span>
                    <span className="muted small">open engineering roles<br />{i.hiring_signals.board}{i.hiring_signals.guessed ? " (auto-detected)" : ""}</span>
                  </div>
                  {i.hiring_signals.intent_roles.length > 0 && (
                    <>
                      <div className="label">Platform / DevEx / SRE roles</div>
                      <ul className="links">
                        {i.hiring_signals.intent_roles.slice(0, 5).map((r) => (
                          <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></li>
                        ))}
                      </ul>
                    </>
                  )}
                  {i.hiring_signals.tools_mentioned.length > 0 && (
                    <>
                      <div className="label">Tools in job posts</div>
                      <div className="chips">
                        {i.hiring_signals.tools_mentioned.slice(0, 8).map((t) => <Chip key={t.name}>{techLabel(t.name)} ×{t.count}</Chip>)}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="muted small">
                  No public job board found. Set <code>job_board</code> in Supabase (e.g. <code>greenhouse:{c.github_org}</code>).
                </p>
              )}
            </section>

            <section className="card">
              <h2>Recent blog posts & talks</h2>
              {i.web_mentions?.findings?.length ? (
                <ul className="links">
                  {i.web_mentions.findings.map((f, k) => (
                    <li key={k}>
                      <strong className="small">{f.title}</strong>
                      {f.date && <span className="muted small"> · {f.date}</span>}
                      <div className="muted small">{f.insight}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Nothing recent found via Google Search this week.</p>
              )}
              {i.web_mentions?.sources?.length > 0 && (
                <div className="sources small">
                  <span className="label">Sources</span>
                  {i.web_mentions.sources.map((s, k) => (
                    <a key={k} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                  ))}
                </div>
              )}
            </section>
          </div>
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

function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="stat-value">{value ?? "—"}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}
