// Fit score (0–100) computed in code from live signals — never by the LLM — so every point
// is explainable and backed by evidence. Rubric: docs/10-product-spec-icp-and-fit-score.md §3.

import { techLabel } from "./tech.js";

export const TIERS = [
  { tier: "A", min: 75, label: "Call this week" },
  { tier: "B", min: 50, label: "Nurture" },
  { tier: "C", min: 0, label: "Deprioritize" },
];

/**
 * Merge infra evidence from all sources into one list:
 * [{ key, label, sources: ["github", "jobs", "web"], evidence: [...] }]
 */
export function mergeInfra({ github, jobs, web }) {
  const map = new Map();
  const add = (key, source, evidence) => {
    if (!map.has(key)) map.set(key, { key, label: techLabel(key), sources: new Set(), evidence: [] });
    const item = map.get(key);
    item.sources.add(source);
    if (evidence && item.evidence.length < 4) item.evidence.push(evidence);
  };
  for (const i of github?.infra ?? []) for (const ev of i.evidence) add(i.key, "github", ev);
  for (const t of jobs?.tools_mentioned ?? []) add(t.name, "jobs", `mentioned in ${t.count} engineering job post${t.count > 1 ? "s" : ""}`);
  for (const f of web?.findings ?? []) for (const k of f.tech_keys ?? []) add(k, "web", f.title ? `"${f.title}"` : "web research");
  return [...map.values()]
    .map((i) => ({ ...i, sources: [...i.sources] }))
    .sort((a, b) => b.sources.length - a.sources.length || b.evidence.length - a.evidence.length);
}

export function activityLevel(activity) {
  const n = activity?.repos_pushed_90d ?? 0;
  if (n >= 20) return "High";
  if (n >= 5) return "Medium";
  if (n >= 1) return "Low";
  return "None";
}

/**
 * @param {{github:object, jobs:object|null, web:object|null}} signals
 * @param {{strong_languages:string[], neutral_languages:string[], target_clouds:string[], target_runtime:string[]}} profile
 */
export function scoreCompany(signals, profile) {
  const { github, jobs, web } = signals;
  const infra = mergeInfra(signals);
  const has = (key) => infra.find((i) => i.key === key);
  const lower = (arr) => arr.map((s) => s.toLowerCase());
  const breakdown = [];

  // 1. Language fit (25)
  {
    const strong = lower(profile.strong_languages);
    const neutral = lower(profile.neutral_languages);
    let share = 0;
    const evidence = [];
    for (const l of github?.topLanguages ?? []) {
      const n = l.name.toLowerCase();
      if (strong.includes(n)) { share += l.pct; evidence.push(`${l.name} ${l.pct}% (target)`); }
      else if (neutral.includes(n)) { share += l.pct / 2; evidence.push(`${l.name} ${l.pct}% (partial)`); }
    }
    // No public code? Fall back to languages named in job posts, at reduced weight.
    if (!github?.topLanguages?.length && jobs?.languages_mentioned?.length) {
      const hit = jobs.languages_mentioned.filter((l) => strong.includes(l.name.toLowerCase()));
      if (hit.length) { share = 50; evidence.push(`Job posts mention ${hit.map((l) => l.name).join(", ")}`); }
    }
    const points = Math.round((Math.min(share, 100) / 100) * 25);
    breakdown.push({ key: "language", label: "Language fit", points, max: 25, evidence: evidence.length ? evidence : ["No target languages found"] });
  }

  // 2. Infra / cloud fit (25)
  {
    let points = 0;
    const evidence = [];
    const runtime = profile.target_runtime.map((k) => has(k)).filter(Boolean);
    if (runtime.length) { points += 10; evidence.push(`Runtime: ${runtime.map((i) => i.label).join(", ")}`); }
    const clouds = profile.target_clouds.map((k) => has(k)).filter(Boolean);
    const otherCloud = ["aws", "gcp", "azure"].filter((k) => !profile.target_clouds.includes(k)).map(has).find(Boolean);
    if (clouds.length) { points += 10; evidence.push(`Cloud: ${clouds.map((i) => i.label).join(", ")}`); }
    else if (otherCloud) { points += 4; evidence.push(`Cloud: ${otherCloud.label} (not a primary target)`); }
    const iac = has("terraform") ?? has("pulumi");
    if (iac) { points += 5; evidence.push(`Infrastructure as code: ${iac.label}`); }
    breakdown.push({ key: "infra", label: "Cloud & infra fit", points, max: 25, evidence: evidence.length ? evidence : ["No cloud or container tooling visible"] });
  }

  // 3. Microservices signal (15)
  {
    let points = 0;
    const evidence = [];
    const svc = github?.serviceRepos ?? [];
    if (svc.length >= 5) { points += 8; evidence.push(`${svc.length} service-style repos (e.g. ${svc.slice(0, 3).join(", ")})`); }
    else if (svc.length >= 2) { points += 4; evidence.push(`Service-style repos: ${svc.join(", ")}`); }
    if (has("grpc")) { points += 4; evidence.push("gRPC / Protobuf in use"); }
    const mono = has("bazel") ?? has("nx") ?? has("turborepo");
    if (mono) { points += 3; evidence.push(`Monorepo tooling: ${mono.label}`); }
    if (has("microservices") || has("kafka")) { points += 3; evidence.push((has("microservices") ?? has("kafka")).label + " mentioned"); }
    breakdown.push({ key: "microservices", label: "Microservices signal", points: Math.min(points, 15), max: 15, evidence: evidence.length ? evidence : ["No microservice architecture signals"] });
  }

  // 4. Build velocity (15)
  {
    const n = github?.activity?.repos_pushed_90d ?? 0;
    const points = n >= 20 ? 15 : n >= 10 ? 10 : n >= 3 ? 5 : n >= 1 ? 2 : 0;
    breakdown.push({ key: "velocity", label: "Build velocity", points, max: 15, evidence: [`${n} repos pushed in the last 90 days (${github?.activity?.repos_pushed_30d ?? 0} in the last 30)`] });
  }

  // 5. CI pain (10)
  {
    let points = 0;
    const evidence = [];
    const ci = github?.ci;
    if (ci?.checked) {
      if (ci.reposWithCi / ci.checked >= 0.6) { points += 4; evidence.push(`${ci.reposWithCi}/${ci.checked} active repos run CI`); }
      if (ci.reposWithCi && ci.workflowCount / ci.reposWithCi >= 3) { points += 2; evidence.push(`${ci.workflowCount} workflows across ${ci.reposWithCi} repos`); }
    }
    if (jobs?.ci_pain?.length) { points += 4; evidence.push(`Job posts mention "${jobs.ci_pain[0].phrase}"`); }
    breakdown.push({ key: "ci", label: "CI pain signal", points: Math.min(points, 10), max: 10, evidence: evidence.length ? evidence : ["No CI pain visible"] });
  }

  // 6. Buying intent (10)
  {
    const roles = jobs?.intent_roles ?? [];
    const points = roles.length >= 3 ? 10 : roles.length >= 1 ? 6 : 0;
    const evidence = roles.length
      ? roles.slice(0, 3).map((r) => `Hiring: ${r.title}`)
      : [jobs ? "No open platform / DevEx / SRE roles" : "No job board found"];
    breakdown.push({ key: "intent", label: "Buying intent (hiring)", points, max: 10, evidence });
  }

  const fit_score = breakdown.reduce((a, b) => a + b.points, 0);
  const fit_tier = TIERS.find((t) => fit_score >= t.min).tier;

  // Confidence = how much evidence we actually had, so "no data" isn't mistaken for "bad fit".
  const sources = [
    (github?.activity?.active_repos ?? 0) >= 3,
    Boolean(jobs?.total_eng_roles),
    Boolean(web?.findings?.length),
  ].filter(Boolean).length;
  const confidence = sources >= 3 ? "High" : sources === 2 ? "Medium" : "Low";

  return { fit_score, fit_tier, confidence, score_breakdown: breakdown, infra_signals: infra };
}

/** Real, specific terms an opener may reference — used to verify it isn't generic. */
export function openerTerms({ github, jobs, web }, infra) {
  const terms = new Set();
  for (const l of github?.topLanguages?.slice(0, 4) ?? []) terms.add(l.name);
  for (const i of infra.slice(0, 10)) terms.add(i.label);
  for (const r of github?.notableRepos ?? []) terms.add(r.name);
  for (const r of github?.serviceRepos?.slice(0, 8) ?? []) terms.add(r);
  for (const r of jobs?.intent_roles ?? []) terms.add(r.title);
  for (const f of web?.findings ?? []) if (f.title) terms.add(f.title);
  return [...terms].filter((t) => t && t.length >= 2);
}

export function verifyOpener(line, terms) {
  const l = (line ?? "").toLowerCase();
  const hit = terms.find((t) => {
    const n = t.toLowerCase();
    // Short terms (e.g. "Go") must match as a whole word.
    return n.length <= 3
      ? new RegExp(`(?<![a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(l)
      : l.includes(n);
  });
  return hit ?? null;
}
