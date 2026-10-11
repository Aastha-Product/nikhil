import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getCompany } from "@/lib/data";
import { isConfigured } from "@/lib/supabaseAdmin";
import { techLabel } from "@/lib/tech";
import CopyButton from "@/app/components/CopyButton";
import RefreshButton from "@/app/components/RefreshButton";
import StatusSelect from "@/app/components/StatusSelect";
import { Chip, Confidence, isStale, SetupNeeded, TierBadge, timeAgo } from "@/app/components/ui";

// "Refresh now" runs the full pipeline as a server action from this page.
export const maxDuration = 120;

const TIER_TEXT = { A: "Call this week", B: "Nurture", C: "Deprioritize" };

export default function CompanyPage({ params }) {
  return (
    <>
      <Link href="/" className="back">← Watchlist</Link>
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

  return (
    <article className="detail">
      <header className="detail-head">
        <div>
          <h1>{c.name}</h1>
          <div className="muted small">
            <a href={`https://github.com/${c.github_org}`} target="_blank" rel="noreferrer" className="mono">github.com/{c.github_org}</a>
            {c.website && <> · <a href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, "")}</a></>}
          </div>
          <div className={`small ${isStale(i?.last_refreshed) ? "stale" : "muted"}`}>
            Research refreshed {timeAgo(i?.last_refreshed)}
            {i?.last_refreshed && ` (${new Date(i.last_refreshed).toUTCString()})`}
          </div>
        </div>
        <div className="detail-actions">
          <StatusSelect companyId={c.id} value={c.outreach_status} />
          <RefreshButton companyId={c.id} />
        </div>
      </header>

      {i?.status === "error" && (
        <div className="card alert">
          Last refresh failed: {i.error_message}
          {i.summary ? " — showing the previous successful research." : ""}
        </div>
      )}

      {!i?.summary ? (
        <section className="card">
          <p>No research yet. Click <strong>Refresh now</strong> to pull live data (takes ~30 seconds).</p>
        </section>
      ) : (
        <>
          <section className="score-row">
            <div className="card score-card">
              <TierBadge tier={i.fit_tier} score={i.fit_score} />
              <div>
                <div className="score-title">Tier {i.fit_tier} · {TIER_TEXT[i.fit_tier]}</div>
                <Confidence level={i.confidence} />
              </div>
            </div>
            <div className="card opener">
              <div className="label">Suggested first line</div>
              <p className="opener-text">“{i.first_line}”</p>
              <div className="opener-foot">
                <span className="muted small">
                  {i.opener_verified ? "✓ Cites a real signal: " : "⚠ Couldn’t verify the reference: "}
                  <strong>{i.opener_reference}</strong>
                </span>
                <CopyButton text={i.first_line} />
              </div>
            </div>
          </section>

          {i.changes?.any && (
            <section className="card changes">
              <div className="label">What changed since {timeAgo(i.changes.since)}</div>
              <ul>
                {i.changes.score_delta !== 0 && <li>Fit score {i.changes.score_delta > 0 ? "+" : ""}{i.changes.score_delta}</li>}
                {i.changes.new_tools.length > 0 && <li>New tooling: {i.changes.new_tools.join(", ")}</li>}
                {i.changes.dropped_tools.length > 0 && <li>No longer seen: {i.changes.dropped_tools.join(", ")}</li>}
                {i.changes.new_languages.length > 0 && <li>New languages: {i.changes.new_languages.join(", ")}</li>}
              </ul>
            </section>
          )}

          <div className="grid-2">
            <section className="card">
              <h2>Engineering context</h2>
              {i.summary.split(/\n\s*\n/).map((p, k) => <p key={k}>{p}</p>)}
              <h3>Talking points</h3>
              <ol className="points">
                {(i.talking_points ?? []).map((t, k) => <li key={k}>{t}</li>)}
              </ol>
            </section>

            <section className="card">
              <h2>Why this score</h2>
              <ul className="breakdown">
                {(i.score_breakdown ?? []).map((b) => (
                  <li key={b.key}>
                    <div className="breakdown-row">
                      <span>{b.label}</span>
                      <span className="mono">{b.points}/{b.max}</span>
                    </div>
                    <div className="bar"><span style={{ width: `${(b.points / b.max) * 100}%` }} /></div>
                    <div className="muted small">{b.evidence.join(" · ")}</div>
                  </li>
                ))}
              </ul>
              {c.history.length > 1 && (
                <p className="muted small">
                  Score history: {c.history.map((h) => h.fit_score).join(" → ")}
                </p>
              )}
            </section>
          </div>

          <div className="grid-3">
            <section className="card">
              <h2>Languages</h2>
              <ul className="langs">
                {(i.top_languages ?? []).map((l) => (
                  <li key={l.name}>
                    <span>{l.name}</span>
                    <span className="bar"><span style={{ width: `${l.pct}%` }} /></span>
                    <span className="mono small">{l.pct}%</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">By bytes across their most recently active public repos.</p>
            </section>

            <section className="card">
              <h2>Infra & tooling</h2>
              <ul className="infra">
                {(i.infra_signals ?? []).map((s) => (
                  <li key={s.key}>
                    <Chip>{s.label}</Chip>
                    <span className="muted small">{s.sources.join(" + ")} — {s.evidence[0]}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h2>Build activity · {i.activity_level}</h2>
              <dl className="stats">
                <dt>Repos pushed (30 days)</dt><dd>{i.activity_detail?.repos_pushed_30d}</dd>
                <dt>Repos pushed (90 days)</dt><dd>{i.activity_detail?.repos_pushed_90d}</dd>
                <dt>Active public repos</dt><dd>{i.activity_detail?.active_repos}</dd>
                <dt>Last push</dt><dd>{timeAgo(i.activity_detail?.last_push)}</dd>
              </dl>
            </section>
          </div>

          <div className="grid-3">
            <section className="card">
              <h2>Notable repos</h2>
              <ul className="links">
                {(i.notable_repos ?? []).map((r) => (
                  <li key={r.name}>
                    <a href={r.url} target="_blank" rel="noreferrer" className="mono">{r.name}</a>
                    <span className="muted small"> ★ {r.stars.toLocaleString()} · {r.language ?? "—"}</span>
                    {r.description && <div className="muted small">{r.description}</div>}
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h2>Hiring signals</h2>
              {i.hiring_signals?.board ? (
                <>
                  <p className="small">
                    {i.hiring_signals.total_eng_roles} engineering roles open
                    <span className="muted"> ({i.hiring_signals.board}{i.hiring_signals.guessed ? ", auto-detected" : ""})</span>
                  </p>
                  {i.hiring_signals.intent_roles.length > 0 && (
                    <>
                      <div className="label">Platform / DevEx / SRE roles</div>
                      <ul className="links">
                        {i.hiring_signals.intent_roles.map((r) => (
                          <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></li>
                        ))}
                      </ul>
                    </>
                  )}
                  {i.hiring_signals.tools_mentioned.length > 0 && (
                    <div className="chips">
                      {i.hiring_signals.tools_mentioned.slice(0, 8).map((t) => <Chip key={t.name}>{techLabel(t.name)} ×{t.count}</Chip>)}
                    </div>
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
                      <strong className="small">{f.title}</strong>{f.date && <span className="muted small"> · {f.date}</span>}
                      <div className="muted small">{f.insight}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Nothing recent found via Google Search.</p>
              )}
              {i.web_mentions?.sources?.length > 0 && (
                <div className="sources small">
                  Sources:{" "}
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
