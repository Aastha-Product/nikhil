// Live smoke test of the data layer — no Supabase or Gemini needed.
// Usage: node scripts/smoke.mjs stripe "Stripe" [greenhouse:stripe]
// Works without GITHUB_TOKEN (60 requests/hour), so test one or two companies at a time.

import { getGithubSignals } from "../lib/github.js";
import { getJobSignals } from "../lib/jobs.js";
import { scoreCompany } from "../lib/score.js";
import { buildEvidence, researchGaps } from "../lib/evidence.js";

const [handle = "stripe", name = "Stripe", job_board] = process.argv.slice(2);
const profile = {
  strong_languages: ["Go", "TypeScript", "JavaScript", "Python", "Java", "Kotlin", "Rust"],
  neutral_languages: ["C#", "Ruby", "Scala"],
  target_clouds: ["aws", "gcp"],
  target_runtime: ["kubernetes", "docker", "helm"],
  intent_role_keywords: ["platform engineer", "platform infrastructure", "developer experience", "developer productivity", "devex", "developer tools", "sre", "site reliability", "infrastructure", "devops", "build engineer", "build infrastructure", "release engineer", "ci/cd"],
};

const t0 = Date.now();
const [github, jobs] = await Promise.all([
  getGithubSignals({ name, github_org: handle }),
  getJobSignals({ name, github_org: handle, job_board }, profile).catch((e) => ({ error: e.message })),
]);
const scored = scoreCompany({ github, jobs: jobs?.error ? null : jobs, web: null }, profile);
const evidence = buildEvidence({ name, github_org: handle }, { github, jobs, web: null });
const gaps = researchGaps({ name, github_org: handle }, { github, jobs, web: null }, evidence);

console.log(JSON.stringify({
  company: name,
  took_ms: Date.now() - t0,
  languages: github.topLanguages.map(({ name, pct }) => ({ name, pct })),
  activity: github.activity,
  service_repos: github.serviceRepos.slice(0, 8).map((r) => r.name),
  ci: github.ci,
  jobs: jobs && { board: jobs.board, guessed: jobs.guessed, eng_roles: jobs.total_eng_roles, intent_roles: jobs.intent_roles?.map((r) => r.title), tools: jobs.tools_mentioned?.map((t) => `${t.name}×${t.count}`), ci_pain: jobs.ci_pain?.map((p) => p.phrase), error: jobs.error },
  fit_score: scored.fit_score,
  tier: scored.fit_tier,
  confidence: scored.confidence,
  breakdown: scored.score_breakdown.map((b) => `${b.label}: ${b.points}/${b.max} — ${b.evidence.join("; ")}`),
  infra: scored.infra_signals.map((i) => `${i.label} [${i.sources.join("+")}]`),
  evidence: evidence.map((e) => `[${e.category}/${e.confidence}/${e.freshness}] ${e.claim} <${e.source_url}>`),
  gaps: gaps.map((g) => `${g.area}: ${g.detail}`),
}, null, 2));
