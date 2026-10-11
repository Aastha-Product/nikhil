// The refresh pipeline: live data → score (code) → prose (Gemini) → Supabase.

import "server-only";
import { db } from "./supabaseAdmin.js";
import { getGithubSignals } from "./github.js";
import { getJobSignals } from "./jobs.js";
import { researchWeb, writeIntel } from "./gemini.js";
import { activityLevel, openerTerms, scoreCompany, verifyOpener } from "./score.js";

const STALE_AFTER_MS = 6 * 24 * 60 * 60 * 1000; // daily cron + 6-day staleness = refreshed weekly
const CONCURRENCY = 3;

export async function getProductProfile() {
  const { data, error } = await db().from("product_profile").select("*").eq("id", 1).single();
  if (error) throw new Error(`product_profile: ${error.message}. Did you run supabase/schema.sql?`);
  return data;
}

/** Refresh one company end to end. Never throws — errors are stored on the row. */
export async function refreshCompany(company, product) {
  const startedAt = new Date().toISOString();
  try {
    // 1. Live data, in parallel. Only GitHub is required; the other sources are best-effort.
    const [github, jobs, web] = await Promise.all([
      getGithubSignals(company.github_org),
      getJobSignals(company, product).catch((e) => ({ error: e.message })),
      researchWeb(company).catch((e) => ({ error: e.message, findings: [], sources: [] })),
    ]);
    const jobSignals = jobs?.error ? null : jobs;

    // 2. Score in code.
    const signals = { github, jobs: jobSignals, web };
    const scored = scoreCompany(signals, product);

    // 3. Gemini writes from facts only; verify the opener references a real signal.
    const facts = buildFacts(company, signals, scored);
    const terms = openerTerms(signals, scored.infra_signals);
    let intel = await writeIntel(company, product, facts);
    let reference = verifyOpener(intel.first_line, terms);
    if (!reference) {
      intel = await writeIntel(company, product, facts,
        `Your previous first line was too generic. The new one MUST mention at least one of these exactly: ${terms.slice(0, 12).join(", ")}.`);
      reference = verifyOpener(intel.first_line, terms);
    }

    // 4. What changed since the last snapshot?
    const { data: prev } = await db()
      .from("intel_history")
      .select("fit_score, top_languages, infra_signals, captured_at")
      .eq("company_id", company.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const changes = diff(prev, { fit_score: scored.fit_score, top_languages: github.topLanguages, infra_signals: scored.infra_signals });

    const row = {
      company_id: company.id,
      top_languages: github.topLanguages,
      infra_signals: scored.infra_signals,
      activity_level: activityLevel(github.activity),
      activity_detail: github.activity,
      notable_repos: github.notableRepos,
      hiring_signals: jobSignals ?? (jobs?.error ? { error: jobs.error } : null),
      web_mentions: web,
      fit_score: scored.fit_score,
      fit_tier: scored.fit_tier,
      confidence: scored.confidence,
      score_breakdown: scored.score_breakdown,
      summary: intel.summary,
      first_line: intel.first_line,
      opener_reference: reference ?? intel.opener_reference,
      opener_verified: Boolean(reference),
      talking_points: intel.talking_points,
      changes,
      status: "ok",
      error_message: null,
      last_refreshed: new Date().toISOString(),
      last_attempted: startedAt,
    };
    const { error } = await db().from("company_intel").upsert(row);
    if (error) throw new Error(`Supabase write failed: ${error.message}`);
    await db().from("intel_history").insert({
      company_id: company.id,
      fit_score: scored.fit_score,
      top_languages: github.topLanguages,
      infra_signals: scored.infra_signals,
    });

    return { id: company.id, name: company.name, ok: true, fit_score: scored.fit_score, tier: scored.fit_tier };
  } catch (err) {
    // Keep last week's good data; just flag the error.
    await db().from("company_intel").upsert({
      company_id: company.id,
      status: "error",
      error_message: String(err?.message ?? err).slice(0, 500),
      last_attempted: startedAt,
    });
    return { id: company.id, name: company.name, ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Refresh every company whose data is older than 6 days (or all, with force),
 * stalest first, stopping before the time budget so the function never times out.
 */
// One company takes ~30–60s, so stop starting new ones at 200s to finish inside Vercel's 300s limit.
export async function refreshStale({ force = false, companyId = null, budgetMs = 200_000 } = {}) {
  const t0 = Date.now();
  const product = await getProductProfile();

  let query = db().from("companies").select("*, company_intel(last_refreshed)");
  if (companyId) query = query.eq("id", companyId);
  const { data: companies, error } = await query;
  if (error) throw new Error(error.message);

  const lastRefreshed = (c) => {
    const intel = Array.isArray(c.company_intel) ? c.company_intel[0] : c.company_intel;
    return intel?.last_refreshed ? new Date(intel.last_refreshed).getTime() : 0;
  };
  const queue = companies
    .filter((c) => force || companyId || Date.now() - lastRefreshed(c) > STALE_AFTER_MS)
    .sort((a, b) => lastRefreshed(a) - lastRefreshed(b));

  const results = [];
  let next = 0;
  async function worker() {
    while (next < queue.length && Date.now() - t0 < budgetMs) {
      const company = queue[next++];
      results.push(await refreshCompany(company, product));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return {
    checked: companies.length,
    due: queue.length,
    refreshed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    deferred: queue.length - results.length, // picked up by tomorrow's run
    took_ms: Date.now() - t0,
    results,
  };
}

function buildFacts(company, { github, jobs, web }, scored) {
  return {
    company: company.name,
    github: {
      handle: github.login,
      description: github.profile.description,
      public_repos: github.profile.public_repos,
      top_languages: github.topLanguages,
      service_style_repos: github.serviceRepos.slice(0, 10),
      notable_repos: github.notableRepos.map(({ name, description, language, stars }) => ({ name, description, language, stars })),
      activity: github.activity,
      ci: github.ci,
    },
    infra_and_tooling: scored.infra_signals.map((i) => ({ tool: i.label, seen_in: i.sources, evidence: i.evidence.slice(0, 2) })),
    hiring: jobs
      ? {
          engineering_roles_open: jobs.total_eng_roles,
          platform_devex_sre_roles: jobs.intent_roles.map((r) => r.title),
          tools_in_job_posts: jobs.tools_mentioned.map((t) => t.name),
          languages_in_job_posts: jobs.languages_mentioned.map((l) => l.name),
          ci_pain_phrases: jobs.ci_pain.map((p) => `${p.phrase} (${p.title})`),
        }
      : "No job board found",
    recent_web_mentions: web?.findings?.length ? web.findings.map(({ title, date, insight }) => ({ title, date, insight })) : "None found",
    fit: {
      score: scored.fit_score,
      tier: scored.fit_tier,
      strongest: [...scored.score_breakdown].sort((a, b) => b.points / b.max - a.points / a.max).slice(0, 3)
        .map((b) => `${b.label}: ${b.evidence.join("; ")}`),
    },
  };
}

function diff(prev, curr) {
  if (!prev) return { first_snapshot: true };
  const names = (arr, f) => new Set((arr ?? []).map(f));
  const prevLang = names(prev.top_languages, (l) => l.name);
  const currLang = names(curr.top_languages, (l) => l.name);
  const prevInfra = names(prev.infra_signals, (i) => i.label);
  const currInfra = names(curr.infra_signals, (i) => i.label);
  const out = {
    since: prev.captured_at,
    score_delta: curr.fit_score - (prev.fit_score ?? 0),
    new_languages: [...currLang].filter((x) => !prevLang.has(x)),
    dropped_languages: [...prevLang].filter((x) => !currLang.has(x)),
    new_tools: [...currInfra].filter((x) => !prevInfra.has(x)),
    dropped_tools: [...prevInfra].filter((x) => !currInfra.has(x)),
  };
  out.any = Boolean(out.score_delta || out.new_languages.length || out.dropped_languages.length || out.new_tools.length || out.dropped_tools.length);
  return out;
}
