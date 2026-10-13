// Unit tests for the evidence rules (architecture doc §5, §6, §10, §13). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvidence, citedEvidence, freshness, researchGaps, toBundle, unsupportedClaims } from "../lib/evidence.js";

const NOW = Date.parse("2026-10-12T00:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

const company = { name: "Acme", website: "https://acme.dev", github_org: "acme" };
const github = {
  login: "acme",
  kind: "org",
  match: "given",
  profile: { url: "https://github.com/acme" },
  topLanguages: [
    { name: "Go", pct: 62, repos: [{ name: "api", pushed_at: daysAgo(3) }, { name: "worker", pushed_at: daysAgo(10) }] },
    { name: "Ruby", pct: 4, repos: [{ name: "legacy", pushed_at: daysAgo(500) }] },
  ],
  infra: [
    { key: "kubernetes", evidence: [{ text: 'topic "kubernetes" on deploy', url: "https://github.com/acme/deploy", date: daysAgo(5) }] },
    { key: "github-actions", evidence: [{ text: "6/6 most active repos run GitHub Actions", url: "https://github.com/acme/api/tree/HEAD/.github/workflows", date: daysAgo(3) }] },
  ],
  activity: { active_repos: 40, repos_pushed_30d: 12, repos_pushed_90d: 25, last_push: daysAgo(1), last_push_repo: { name: "api" } },
};
const jobs = {
  board: "greenhouse:acme",
  guessed: false,
  total_roles: 50,
  total_eng_roles: 20,
  intent_roles: [{ title: "Senior Platform Engineer", url: "https://job/1", date: daysAgo(7) }],
  tools_mentioned: [
    { name: "kubernetes", count: 4, jobs: [{ title: "SRE", url: "https://job/2", date: daysAgo(2) }] },
    { name: "aws", count: 1, jobs: [{ title: "Backend Engineer", url: "https://job/3", date: daysAgo(20) }] },
  ],
  languages_mentioned: [{ name: "Go", count: 6, jobs: [{ title: "Backend Engineer", url: "https://job/3", date: daysAgo(20) }] }],
  ci_pain: [],
};
const web = {
  findings: [
    { title: "How Acme runs Kafka", date: "2026-05", type: "engineering_blog", domain: "acme.dev", url: "https://acme.dev/blog/kafka", insight: "Acme moved event processing to Kafka.", technologies: ["Kafka"], tech_keys: ["kafka"] },
    { title: "Acme raises money", date: "2026-08", type: "third_party", domain: "news.example", url: "https://news.example/acme", insight: "A report says Acme uses Azure.", technologies: ["Azure"], tech_keys: ["azure"] },
  ],
};

const ev = buildEvidence(company, { github, jobs, web }, NOW);
const find = (pred) => ev.find(pred);

test("every finding has a source URL, type, tier, status, confidence, freshness and caveat", () => {
  assert.ok(ev.length >= 8);
  for (const e of ev) {
    assert.ok(e.source_url, `missing url: ${e.claim}`);
    assert.ok(["repository", "job_posting", "engineering_blog", "conference_talk", "company_page", "third_party", "api"].includes(e.source_type));
    assert.ok([1, 2, 3].includes(e.source_tier));
    assert.ok(["high", "medium", "low"].includes(e.confidence));
    assert.ok(["current", "aging", "stale", "unknown"].includes(e.freshness));
    assert.ok(e.caveat && e.caveat.length > 10, `missing caveat: ${e.claim}`);
  }
});

test("a dominant language across several repos is high confidence; a tiny old one is not", () => {
  assert.equal(find((e) => e.source_type === "repository" && e.signal_key === "Go").confidence, "high");
  const ruby = find((e) => e.signal_key === "Ruby");
  assert.notEqual(ruby.confidence, "high");
  assert.equal(ruby.freshness, "stale");
});

test("a tool seen only in public code is medium, but corroborated by job posts it becomes high", () => {
  const k8sRepo = find((e) => e.source_type === "repository" && e.signal_key === "kubernetes");
  assert.equal(k8sRepo.confidence, "high");
  assert.match(k8sRepo.caveat, /Corroborated by 2 source types/);
});

test("official blog = Tier 1 directly stated; third-party = Tier 3, low, inferred", () => {
  const blog = find((e) => e.source_url === "https://acme.dev/blog/kafka");
  assert.equal(blog.source_type, "engineering_blog");
  assert.equal(blog.source_tier, 1);
  assert.equal(blog.evidence_status, "directly_stated");
  const news = find((e) => e.source_url === "https://news.example/acme");
  assert.equal(news.source_type, "third_party");
  assert.equal(news.source_tier, 3);
  assert.equal(news.confidence, "low");
  assert.equal(news.evidence_status, "inferred");
});

test("an auto-detected job board can't produce high-confidence evidence on its own", () => {
  const guessed = buildEvidence(company, { github: null, jobs: { ...jobs, guessed: true }, web: null }, NOW);
  assert.ok(guessed.every((e) => e.confidence !== "high" || e.caveat.includes("Corroborated")));
});

test("freshness is source-specific", () => {
  assert.equal(freshness("job_posting", daysAgo(30), NOW), "current");
  assert.equal(freshness("job_posting", daysAgo(200), NOW), "aging");
  assert.equal(freshness("conference_talk", daysAgo(200), NOW), "current");
  assert.equal(freshness("conference_talk", daysAgo(900), NOW), "stale");
  assert.equal(freshness("engineering_blog", null, NOW), "unknown");
});

test("research gaps list missing and failed sources instead of guessing", () => {
  const gaps = researchGaps({ name: "NoCode Inc" }, { github: null, jobs: { error: "Greenhouse 500" }, web: { findings: [] } }, []);
  const areas = gaps.map((g) => g.area);
  assert.ok(areas.includes("Public code"));
  assert.ok(gaps.some((g) => g.area === "Hiring" && /couldn't be read/.test(g.detail)));
  assert.ok(areas.includes("Blogs & talks"));
  assert.ok(areas.includes("Cloud"));
});

test("unsupported claims: tools named without evidence are flagged; the seller's own terms are allowed", () => {
  const pitch = "FlowForge offers preview environments on Kubernetes.";
  assert.deepEqual(unsupportedClaims("Acme runs Go services on Kubernetes with Kafka.", ev, pitch), []);
  assert.deepEqual(unsupportedClaims("Acme's Jenkins pipelines and Rust services…", ev, pitch).sort(), ["Jenkins", "Rust"]);
});

test("citations resolve to real evidence IDs only", () => {
  const bundle = toBundle(ev);
  assert.equal(bundle[0].ref, "E1");
  assert.equal(bundle[0].confidence, "high");
  const cited = citedEvidence(["e1", "E999", " E2 "], bundle);
  assert.deepEqual(cited.map((e) => e.ref), ["E1", "E2"]);
});

test("edited/restored lines are re-checked against strong evidence", async () => {
  const { evidenceMentionedIn } = await import("../lib/evidence.js");
  const hits = evidenceMentionedIn("Your Go services on Kubernetes could build faster.", ev);
  assert.ok(hits.some((e) => e.signal_key === "kubernetes"));
  assert.ok(hits.some((e) => e.signal_key === "Go"));
  assert.equal(evidenceMentionedIn("Let's get going on a quick chat.", ev).length, 0);
});

test("no-score verdict: outside target customers only for non-software companies", async () => {
  const { noScoreVerdict } = await import("../lib/evidence.js");
  assert.equal(noScoreVerdict({ company_type: "non_software", industry: "Consumer electronics" }).code, "outside_icp");
  assert.match(noScoreVerdict({ company_type: "non_software", industry: "Consumer electronics" }).reason, /consumer electronics company/);
  assert.equal(noScoreVerdict({ company_type: "software" }).code, "unknown_tech");
  assert.equal(noScoreVerdict({ company_type: "tech_enabled" }).code, "unknown_tech");
  assert.equal(noScoreVerdict({ company_type: "unknown" }).code, "unknown");
  assert.equal(noScoreVerdict(null).code, "unknown");
});

test("job posts on third-party job sites are never treated as official", () => {
  const web = { findings: [
    { title: "SRE Engineer – Azure", date: "2026-09", type: "job_posting", domain: "dice.com", url: "https://www.dice.com/job/1", first_party: true, insight: "Role requires AKS.", technologies: ["Azure"], tech_keys: ["azure"] },
    { title: "DevOps Engineer", date: "2026-09", type: "job_posting", domain: "careers.acme.dev", url: "https://careers.acme.dev/job/2", first_party: true, insight: "Role requires Kubernetes.", technologies: ["Kubernetes"], tech_keys: ["kubernetes"] },
  ] };
  const ev = buildEvidence({ name: "Acme", website: "https://acme.dev" }, { github: null, jobs: null, web }, NOW);
  const dice = ev.find((e) => e.source_url.includes("dice.com"));
  const own = ev.find((e) => e.source_url.includes("careers.acme.dev"));
  assert.equal(dice.source_type, "third_party");
  assert.equal(dice.confidence, "low");
  assert.equal(own.source_type, "job_posting");
  assert.equal(own.source_tier, 1);
});
