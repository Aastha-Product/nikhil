// Unit tests for the fit-score rubric. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCompany, verifyOpener, openerTerms, mergeInfra } from "../lib/score.js";

const profile = {
  strong_languages: ["Go", "TypeScript", "JavaScript", "Python", "Java", "Kotlin", "Rust"],
  neutral_languages: ["C#", "Ruby", "Scala"],
  target_clouds: ["aws", "gcp"],
  target_runtime: ["kubernetes", "docker", "helm"],
  intent_role_keywords: ["platform", "devex", "sre"],
};

const strongGithub = {
  topLanguages: [{ name: "Go", pct: 60 }, { name: "TypeScript", pct: 30 }, { name: "Ruby", pct: 10 }],
  infra: [
    { key: "kubernetes", evidence: ["topic kubernetes on deploy"] },
    { key: "aws", evidence: ["repo aws-tools"] },
    { key: "terraform", evidence: ["HCL files in infra"] },
    { key: "grpc", evidence: ["Protocol Buffer files in api"] },
  ],
  serviceRepos: ["auth-service", "billing-service", "api-gateway", "search-api", "event-worker"],
  ci: { checked: 6, reposWithCi: 6, workflowCount: 24 },
  activity: { active_repos: 80, repos_pushed_30d: 15, repos_pushed_90d: 32 },
  notableRepos: [{ name: "api-gateway" }],
};
const strongJobs = {
  total_eng_roles: 12,
  intent_roles: [{ title: "Senior Platform Engineer" }, { title: "SRE" }, { title: "DevEx Engineer" }],
  tools_mentioned: [{ name: "kubernetes", count: 5 }],
  languages_mentioned: [{ name: "Go", count: 6 }],
  ci_pain: [{ phrase: "build times" }],
};
const web = { findings: [{ title: "Scaling CI at Acme", tech_keys: ["bazel"] }] };

test("a strong-fit company lands in Tier A with high confidence", () => {
  const r = scoreCompany({ github: strongGithub, jobs: strongJobs, web }, profile);
  assert.equal(r.fit_tier, "A");
  assert.ok(r.fit_score >= 90, `score ${r.fit_score}`);
  assert.equal(r.confidence, "High");
  assert.equal(r.score_breakdown.reduce((a, b) => a + b.max, 0), 100);
});

test("a PHP monolith with no cloud signals lands in Tier C", () => {
  const github = {
    topLanguages: [{ name: "PHP", pct: 95 }, { name: "JavaScript", pct: 5 }],
    infra: [],
    serviceRepos: [],
    ci: { checked: 2, reposWithCi: 0, workflowCount: 0 },
    activity: { active_repos: 4, repos_pushed_30d: 0, repos_pushed_90d: 1 },
    notableRepos: [],
  };
  const r = scoreCompany({ github, jobs: null, web: null }, profile);
  assert.equal(r.fit_tier, "C");
  assert.ok(r.fit_score < 20, `score ${r.fit_score}`);
  assert.equal(r.confidence, "Low");
});

test("every criterion stays within its max and carries evidence", () => {
  const r = scoreCompany({ github: strongGithub, jobs: strongJobs, web }, profile);
  for (const b of r.score_breakdown) {
    assert.ok(b.points >= 0 && b.points <= b.max, `${b.key}: ${b.points}/${b.max}`);
    assert.ok(b.evidence.length > 0, `${b.key} has no evidence`);
  }
});

test("infra seen in several sources is merged and ranked first", () => {
  const infra = mergeInfra({ github: strongGithub, jobs: strongJobs, web });
  assert.equal(infra[0].key, "kubernetes");
  assert.deepEqual(infra[0].sources.sort(), ["github", "jobs"]);
});

test("opener verification rejects generic lines and accepts specific ones", () => {
  const signals = { github: strongGithub, jobs: strongJobs, web };
  const terms = openerTerms(signals, mergeInfra(signals));
  assert.equal(verifyOpener("Would love to show you how we help engineering teams move faster.", terms), null);
  assert.equal(verifyOpener("With 60% of your code in Go across services like api-gateway, CI time adds up fast.", terms), "Go");
  // "go" inside another word must not count
  assert.equal(verifyOpener("Let's get going on a quick chat about your goals.", ["Go"]), null);
});
