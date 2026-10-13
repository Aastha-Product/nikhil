// The research pipeline (architecture doc §7):
// collect live signals → build evidence records → validate & score (code) → Gemini writes from evidence
// → check the output → save evidence, report, version and run log in Supabase.

import "server-only";
import { db } from "./supabaseAdmin.js";
import { getGithubSignals } from "./github.js";
import { getJobSignals } from "./jobs.js";
import { MODEL, profileCompany, researchWeb, writeReport } from "./gemini.js";
import { activityLevel, scoreCompany } from "./score.js";
import { buildEvidence, citedEvidence, researchGaps, toBundle, unsupportedClaims } from "./evidence.js";

const STALE_AFTER_MS = 6 * 24 * 60 * 60 * 1000; // daily cron + 6-day staleness = each account refreshed weekly
const CONCURRENCY = 3;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const SOURCE_GROUPS = {
  github: ["repository"],
  jobs: ["job_posting"],
  web: ["engineering_blog", "conference_talk", "company_page", "third_party"],
};

export async function getProductProfile() {
  const { data, error } = await db().from("product_profile").select("*").eq("id", 1).single();
  if (error) throw new Error(`product_profile: ${error.message}. Did you run supabase/schema.sql?`);
  return data;
}

const errMsg = (e) => {
  const m = String(e?.message ?? e);
  // Google returns a long JSON body for quota errors; keep the report readable.
  if (e?.status === 429 || /RESOURCE_EXHAUSTED|exceeded your current quota/i.test(m)) return "Google Search daily quota reached; blogs and talks will be checked on the next refresh";
  return m.slice(0, 300);
};

/** Refresh one company end to end. Never throws — failures are recorded and last good data is kept. */
export async function refreshCompany(company, product) {
  const startedAt = new Date().toISOString();
  // Claim the company so two runs (e.g. the daily job and "Refresh now") never research it at once.
  // A claim older than 10 minutes is treated as stuck (crashed run) and can be taken over.
  const stuckBefore = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();
  const { data: claimed } = await db()
    .from("companies")
    .update({ research_status: "researching", updated_at: startedAt })
    .eq("id", company.id)
    .or(`research_status.neq.researching,updated_at.lt.${stuckBefore}`)
    .select("id");
  if (!claimed?.length) return { id: company.id, name: company.name, ok: true, skipped: true };

  try {
    // 1–3. Discover & collect, in parallel. A source that fails is recorded, not fatal.
    const [github, jobs, web] = await Promise.all([
      getGithubSignals(company).catch((e) => ({ error: errMsg(e) })),
      getJobSignals(company, product).catch((e) => ({ error: errMsg(e) })),
      researchWeb(company).catch((e) => ({ error: errMsg(e), findings: [], sources: [] })),
    ]);
    const signals = { github, jobs, web };
    const ok = (s) => (s && !s.error ? s : null);

    // 4–5. Evidence records with rule-based confidence; carry forward last good evidence for failed sources.
    let evidence = buildEvidence(company, signals);
    const failedGroups = Object.entries({ github, jobs, web }).filter(([, s]) => s?.error).map(([k]) => k);
    if (failedGroups.length) {
      const types = failedGroups.flatMap((g) => SOURCE_GROUPS[g]);
      const { data: previous } = await db().from("evidence").select("*").eq("company_id", company.id).in("source_type", types);
      evidence = evidence.concat(
        (previous ?? []).map(({ id, company_id, ...e }) => ({ ...e, caveat: `${e.caveat ?? ""} Carried over from the last successful check.`.trim() }))
      );
    }
    const gaps = researchGaps(company, signals, evidence);

    // 6. Profile + fit score (code, not AI).
    const scored = scoreCompany({ github: ok(github), jobs: ok(jobs), web: ok(web) }, product);
    const bundle = toBundle(evidence);
    const strong = bundle.filter((e) => e.confidence !== "low");
    // No medium/high evidence = we can't judge fit. Missing evidence is not a bad fit, so don't score it.
    const fit = strong.length
      ? { score: scored.fit_score, tier: scored.fit_tier, confidence: scored.confidence }
      : { score: null, tier: null, confidence: "Low" };

    // 7. Gemini writes from the evidence bundle; code checks citations and unsupported claims.
    let report = null;
    let cited = [];
    let unsupported = [];
    let companyProfile = null;
    if (strong.length) {
      const fitText = `${scored.fit_score}/100, Tier ${scored.fit_tier}. Strongest: ${[...scored.score_breakdown]
        .sort((a, b) => b.points / b.max - a.points / a.max).slice(0, 3).map((b) => `${b.label} (${b.evidence[0]})`).join("; ")}`;
      const attempt = async (feedback) => {
        const r = await writeReport(company, product, bundle, { fit: fitText, gaps }, feedback);
        const c = citedEvidence(r.outreach_evidence_ids, bundle).filter((e) => e.confidence !== "low");
        const u = unsupportedClaims(`${r.paragraphs.join(" ")} ${r.first_line}`, evidence, product.pitch);
        return { r, c, u };
      };
      let a = await attempt();
      if (!a.c.length || a.u.length) {
        a = await attempt(
          [
            !a.c.length && "The outreach line must cite at least one high- or medium-confidence evidence ID in outreach_evidence_ids.",
            a.u.length && `You mentioned ${a.u.join(", ")}, which is not in the evidence. Remove it.`,
          ].filter(Boolean).join(" ")
        );
      }
      ({ r: report, c: cited, u: unsupported } = a);
    } else {
      gaps.push({ area: "Personalization", detail: "Not enough medium- or high-confidence evidence for a reliable personalized opening line." });
      // No engineering evidence: find out who the company is, so the report can explain why (with sources).
      companyProfile = await profileCompany(company).catch(() => null);
    }

    const summary = report ? report.paragraphs.join("\n\n") : "Not enough public evidence was found to write a reliable engineering summary. See the research gaps below.";
    const firstLine = report?.first_line ?? null;
    const now = new Date().toISOString();

    // What changed since the last snapshot?
    const { data: prev } = await db()
      .from("intel_history")
      .select("fit_score, top_languages, infra_signals, captured_at")
      .eq("company_id", company.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const topLanguages = ok(github)?.topLanguages.map(({ name, pct }) => ({ name, pct })) ?? [];
    const changes = diff(prev, { fit_score: fit.score, top_languages: topLanguages, infra_signals: scored.infra_signals });

    // 8. Save: evidence (replace), profile/report (upsert), versions, history, status.
    await db().from("evidence").delete().eq("company_id", company.id);
    if (evidence.length) {
      const { error } = await db().from("evidence").insert(evidence.map((e) => ({ ...e, company_id: company.id, observed_at: e.observed_at ?? now })));
      if (error) throw new Error(`Saving evidence failed: ${error.message}`);
    }

    const gh = ok(github);
    const jb = ok(jobs);
    const row = {
      company_id: company.id,
      top_languages: topLanguages,
      infra_signals: scored.infra_signals,
      activity_level: gh ? activityLevel(gh.activity) : "None",
      activity_detail: gh?.activity ?? null,
      notable_repos: gh?.notableRepos ?? [],
      hiring_signals: jb ? { ...jb, tools_mentioned: jb.tools_mentioned.map(({ name, count }) => ({ name, count })) } : jobs?.error ? { error: jobs.error } : null,
      web_mentions: { findings: ok(web)?.findings ?? [], sources: ok(web)?.sources ?? [], company_profile: companyProfile },
      fit_score: fit.score,
      fit_tier: fit.tier,
      confidence: fit.confidence,
      score_breakdown: scored.score_breakdown,
      summary,
      first_line: firstLine,
      opener_reference: cited[0]?.claim ?? null,
      opener_verified: Boolean(cited.length && !unsupportedClaims(firstLine ?? "", evidence, product.pitch).length),
      opener_evidence: cited.map(({ ref, claim, source_url, source_title, confidence }) => ({ ref, claim, source_url, source_title, confidence })),
      unsupported_claims: unsupported,
      talking_points: report?.talking_points ?? [],
      research_gaps: gaps,
      changes,
      summary_origin: "ai_refresh",
      first_line_origin: "ai_refresh",
      model: report?.model ?? MODEL(),
      generated_at: now,
      status: "ok",
      error_message: failedGroups.length ? `Some sources failed: ${failedGroups.join(", ")}` : null,
      last_refreshed: now,
      last_attempted: startedAt,
    };
    const { error } = await db().from("company_intel").upsert(row);
    if (error) throw new Error(`Supabase write failed: ${error.message}`);

    const usedModel = report?.model ?? MODEL();
    const versions = [{ company_id: company.id, output_type: "summary", content: summary, origin: "ai_refresh", model: usedModel }];
    if (firstLine) versions.push({ company_id: company.id, output_type: "first_line", content: firstLine, origin: "ai_refresh", model: usedModel });
    await db().from("report_versions").insert(versions);
    await db().from("intel_history").insert({
      company_id: company.id,
      fit_score: fit.score,
      top_languages: topLanguages,
      infra_signals: scored.infra_signals,
    });

    const partial = failedGroups.length > 0 || !report;
    const companyFields = { research_status: partial ? "partial" : "ready", updated_at: now };
    // Remember a GitHub account once the company's own website confirms it.
    if (!company.github_org && gh?.match === "domain_verified") companyFields.github_org = gh.login.toLowerCase();
    await db().from("companies").update(companyFields).eq("id", company.id);

    return { id: company.id, name: company.name, ok: true, partial, fit_score: fit.score, tier: fit.tier, evidence: evidence.length };
  } catch (err) {
    // Keep last week's good report; just flag the failure (§10, §13).
    await db().from("company_intel").upsert({
      company_id: company.id,
      status: "error",
      error_message: errMsg(err),
      last_attempted: startedAt,
    });
    await db().from("companies").update({ research_status: "failed", updated_at: new Date().toISOString() }).eq("id", company.id);
    return { id: company.id, name: company.name, ok: false, error: errMsg(err) };
  }
}

/**
 * Refresh active companies whose research is older than 6 days (or all with force, or one by id),
 * stalest first, in small parallel batches, stopping before the time budget. Logs a refresh_runs row.
 */
// One company takes ~30–90s, so stop starting new ones at 150s to finish inside Vercel's 300s limit.
export async function refreshStale({ force = false, companyId = null, trigger = "cron", budgetMs = 150_000 } = {}) {
  const t0 = Date.now();
  const { data: run } = await db().from("refresh_runs").insert({ trigger }).select("id").single();

  try {
    const product = await getProductProfile();
    let query = db().from("companies").select("*, company_intel(last_refreshed)").eq("active", true);
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

    const skipped = results.filter((r) => r.skipped);
    const done = results.filter((r) => !r.skipped);
    const failed = done.filter((r) => !r.ok);
    const deferred = queue.length - results.length;
    const summary = {
      checked: companies.length,
      due: queue.length,
      refreshed: done.length - failed.length,
      skipped: skipped.length, // already being researched by another run
      partial: results.filter((r) => r.ok && r.partial).length,
      failed,
      deferred, // picked up by tomorrow's run
      took_ms: Date.now() - t0,
      results,
    };
    await finishRun(run?.id, {
      status: failed.length || deferred ? (summary.refreshed ? "partial" : "failed") : "succeeded",
      companies_attempted: done.length,
      companies_succeeded: summary.refreshed,
      companies_failed: failed.length,
      companies_deferred: deferred,
      error_summary: failed.length ? failed.map((f) => ({ company: f.name, error: f.error })) : null,
    });
    return summary;
  } catch (err) {
    await finishRun(run?.id, { status: "failed", error_summary: [{ error: errMsg(err) }] });
    throw err;
  }
}

async function finishRun(id, fields) {
  if (!id) return;
  await db().from("refresh_runs").update({ ...fields, completed_at: new Date().toISOString() }).eq("id", id);
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
    score_delta: curr.fit_score != null && prev.fit_score != null ? curr.fit_score - prev.fit_score : 0,
    new_languages: [...currLang].filter((x) => !prevLang.has(x)),
    dropped_languages: [...prevLang].filter((x) => !currLang.has(x)),
    new_tools: [...currInfra].filter((x) => !prevInfra.has(x)),
    dropped_tools: [...prevInfra].filter((x) => !currInfra.has(x)),
  };
  out.any = Boolean(out.score_delta || out.new_languages.length || out.dropped_languages.length || out.new_tools.length || out.dropped_tools.length);
  return out;
}
