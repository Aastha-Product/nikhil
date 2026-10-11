// Evidence layer — turns live signals into traceable evidence records and judges them by rule,
// never by the AI. Implements the architecture doc:
//   §5 source hierarchy (Tier 1–3) · §6 evidence record + confidence rules · §10 freshness
//   §13 research gaps and unsupported-claim checks.

import { detectLanguages, detectTech, techLabel } from "./tech.js";

const DAY = 24 * 60 * 60 * 1000;

const CAVEATS = {
  repo_language: "Public repositories only; private and internal code isn't visible.",
  repo_tool: "Appears in public code; doesn't prove production use.",
  repo_ci: "Shows CI configuration in public repos only.",
  job_tool: "Listed as a hiring requirement; not proof of current production use.",
  job_language: "Hiring requirement; doesn't mean the whole company uses it.",
  job_count: "Counts roles on the public job board only.",
  intent_role: "An open role shows investment in this area, not a need for any specific product.",
  ci_phrase: "Mentions a focus area; doesn't establish a pain point.",
  activity: "Public repository activity only; internal work isn't visible.",
  official: "Company-published; may describe one team rather than the whole company.",
  talk: "A past talk; may not reflect current usage.",
  third_party: "Third-party reporting; prefer a primary source.",
};

/** §10: source-specific freshness. Fast-moving sources age faster than talks and articles. */
export function freshness(sourceType, date, now = Date.now()) {
  if (!date) return "unknown";
  const days = (now - new Date(date).getTime()) / DAY;
  if (Number.isNaN(days)) return "unknown";
  const fast = ["repository", "job_posting", "api"].includes(sourceType);
  const [current, aging] = fast ? [90, 365] : [365, 730];
  return days <= current ? "current" : days <= aging ? "aging" : "stale";
}

const monthToIso = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})(?:-(\d{2}))?/);
  return m ? new Date(Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, 1)).toISOString() : null;
};

const boardUrl = (board) => {
  const [p, t] = String(board).split(":");
  return { greenhouse: `https://job-boards.greenhouse.io/${t}`, lever: `https://jobs.lever.co/${t}`, ashby: `https://jobs.ashbyhq.com/${t}` }[p] ?? null;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Build evidence records from this run's signals.
 * @param company {name, website, github_org}
 * @param signals {github, jobs, web} — any may be null (not found) or {error}
 */
export function buildEvidence(company, { github, jobs, web }, now = Date.now()) {
  const out = [];
  const add = (e) => out.push({ excerpt: null, ...e, freshness: freshness(e.source_type, e.source_date, now) });
  const gh = github && !github.error ? github : null;
  const jb = jobs && !jobs.error ? jobs : null;
  const nameOnly = gh?.match === "name_only";
  const capIfGuessed = (conf, guessed) => (guessed && conf === "high" ? "medium" : conf);

  // ── Tier 1: public code repositories ──
  if (gh) {
    const repoListUrl = (lang) =>
      gh.kind === "org"
        ? `https://github.com/orgs/${gh.login}/repositories?language=${encodeURIComponent(lang.toLowerCase())}`
        : `https://github.com/${gh.login}?tab=repositories&language=${encodeURIComponent(lang.toLowerCase())}`;

    for (const l of gh.topLanguages.slice(0, 6)) {
      const repos = l.repos ?? [];
      const latest = repos.map((r) => r.pushed_at).sort().at(-1) ?? null;
      let confidence = l.pct >= 15 && repos.length >= 2 ? "high" : l.pct >= 5 || repos.length >= 2 ? "medium" : "low";
      if (nameOnly && confidence === "high") confidence = "medium";
      add({
        category: "language",
        signal_key: l.name,
        claim: `${l.pct}% of code in ${company.name}'s most recently active public repos is ${l.name} (${plural(repos.length, "repo")}).`,
        excerpt: repos.length ? `Seen in: ${repos.slice(0, 4).map((r) => r.name).join(", ")}` : null,
        source_url: repoListUrl(l.name),
        source_title: `GitHub · ${gh.login} repositories in ${l.name}`,
        source_type: "repository",
        source_tier: 1,
        source_date: latest,
        evidence_status: "technically_observed",
        confidence,
        caveat: CAVEATS.repo_language + (nameOnly ? " GitHub account matched by name only." : ""),
      });
    }

    for (const i of gh.infra) {
      const ev = i.evidence[0];
      const isCi = i.key === "github-actions";
      add({
        category: "infrastructure",
        signal_key: i.key,
        claim: isCi ? `${ev.text}.` : `Public code references ${techLabel(i.key)} (${ev.text}).`,
        excerpt: i.evidence.slice(1, 3).map((e) => e.text).join("; ") || null,
        source_url: ev.url,
        source_title: `GitHub · ${ev.url.split("github.com/")[1]?.split("/").slice(0, 2).join("/") ?? gh.login}`,
        source_type: "repository",
        source_tier: 1,
        source_date: ev.date,
        evidence_status: "technically_observed",
        confidence: isCi && !nameOnly ? "high" : "medium",
        caveat: isCi ? CAVEATS.repo_ci : CAVEATS.repo_tool,
      });
    }

    const a = gh.activity;
    add({
      category: "activity",
      signal_key: "repo_activity",
      claim: `${plural(a.repos_pushed_90d, "public repo")} pushed in the last 90 days (${a.repos_pushed_30d} in the last 30); ${a.active_repos} active public repos in total.`,
      excerpt: a.last_push_repo ? `Most recent push: ${a.last_push_repo.name}` : null,
      source_url: gh.profile.url,
      source_title: `GitHub · ${gh.login}`,
      source_type: "repository",
      source_tier: 1,
      source_date: a.last_push,
      evidence_status: "technically_observed",
      confidence: nameOnly ? "medium" : "high",
      caveat: CAVEATS.activity,
    });
  }

  // ── Tier 1: official job postings ──
  if (jb) {
    const g = jb.guessed;
    add({
      category: "activity",
      signal_key: "hiring_volume",
      claim: `${plural(jb.total_eng_roles, "engineering role")} currently open (of ${jb.total_roles} roles on the job board).`,
      source_url: boardUrl(jb.board),
      source_title: `Job board · ${jb.board}${g ? " (auto-detected)" : ""}`,
      source_type: "job_posting",
      source_tier: 1,
      source_date: new Date(now).toISOString(),
      evidence_status: "directly_stated",
      confidence: capIfGuessed("high", g),
      caveat: CAVEATS.job_count + (g ? " Board matched by name; confirm it belongs to this company." : ""),
    });

    for (const t of jb.tools_mentioned.slice(0, 10)) {
      const j = t.jobs[0];
      add({
        category: "infrastructure",
        signal_key: t.name,
        claim: `${plural(t.count, "current engineering job post")} list${t.count === 1 ? "s" : ""} ${techLabel(t.name)}.`,
        excerpt: `e.g. "${j.title}"${t.jobs[1] ? `, "${t.jobs[1].title}"` : ""}`,
        source_url: j.url,
        source_title: j.title,
        source_type: "job_posting",
        source_tier: 1,
        source_date: j.date,
        evidence_status: "directly_stated",
        confidence: capIfGuessed("high", g),
        caveat: CAVEATS.job_tool,
      });
    }

    for (const l of jb.languages_mentioned.slice(0, 5)) {
      const j = l.jobs[0];
      add({
        category: "language",
        signal_key: l.name,
        claim: `${plural(l.count, "current engineering job post")} ask${l.count === 1 ? "s" : ""} for ${l.name}.`,
        excerpt: `e.g. "${j.title}"`,
        source_url: j.url,
        source_title: j.title,
        source_type: "job_posting",
        source_tier: 1,
        source_date: j.date,
        evidence_status: "directly_stated",
        confidence: capIfGuessed(l.count >= 2 ? "high" : "medium", g),
        caveat: CAVEATS.job_language,
      });
    }

    for (const r of jb.intent_roles.slice(0, 4)) {
      add({
        category: "sales_relevance",
        signal_key: "intent_role",
        claim: `Hiring: "${r.title}".`,
        source_url: r.url,
        source_title: r.title,
        source_type: "job_posting",
        source_tier: 1,
        source_date: r.date,
        evidence_status: "directly_stated",
        confidence: capIfGuessed("high", g),
        caveat: CAVEATS.intent_role,
      });
    }

    for (const p of jb.ci_pain.slice(0, 2)) {
      add({
        category: "sales_relevance",
        signal_key: "ci_focus",
        claim: `A current job post mentions "${p.phrase}" ("${p.title}").`,
        source_url: p.url,
        source_title: p.title,
        source_type: "job_posting",
        source_tier: 1,
        source_date: p.date,
        evidence_status: "directly_stated",
        confidence: "medium",
        caveat: CAVEATS.ci_phrase,
      });
    }
  }

  // ── Tier 1–3: engineering blogs, talks, docs, third-party articles (discovered via Google Search) ──
  const companyDomain = company.website ? hostname(company.website) : null;
  const officialMarkers = [companyDomain, gh?.login, slug(company.name)].filter(Boolean);
  for (const f of web?.findings ?? []) {
    const domainMatch = officialMarkers.some((m) => f.domain === m || f.domain.endsWith(`.${m}`) || f.domain.split(".")[0] === m);
    // A company blog on another domain (e.g. a parent company's) counts as official, but only medium confidence.
    const official = domainMatch || f.first_party === true;
    const unconfirmedOwner = official && !domainMatch;
    const isTalk = f.type === "conference_talk";
    const source_type = official
      ? f.type === "engineering_blog" ? "engineering_blog" : isTalk ? "conference_talk" : "company_page"
      : isTalk ? "conference_talk" : "third_party";
    const source_tier = source_type === "engineering_blog" || (official && f.type === "docs") ? 1 : source_type === "third_party" ? 3 : 2;
    const date = monthToIso(f.date);
    const recent = date && now - new Date(date).getTime() <= 730 * DAY;
    const confidence = source_type === "third_party" ? "low" : isTalk || unconfirmedOwner ? "medium" : official && recent ? "high" : "medium";
    add({
      category: f.tech_keys.length ? "infrastructure" : "context",
      signal_key: f.tech_keys[0] ?? null,
      claim: f.insight,
      excerpt: f.technologies.length ? `Mentions: ${f.technologies.slice(0, 6).join(", ")}` : null,
      source_url: f.url,
      source_title: f.title ?? f.domain,
      source_type,
      source_tier,
      source_date: date,
      evidence_status: source_type === "third_party" ? "inferred" : "directly_stated",
      confidence,
      caveat: (source_type === "third_party" ? CAVEATS.third_party : isTalk ? CAVEATS.talk : CAVEATS.official)
        + (unconfirmedOwner ? ` Published on ${f.domain}; identified as the company's own by search, not by its website domain.` : ""),
      extra_keys: f.tech_keys.slice(1),
    });
  }

  return corroborate(out);
}

/** §6: "multiple independent sources that agree" → high. Old (stale) evidence can't be high. */
function corroborate(records) {
  const typesByKey = new Map();
  for (const r of records) {
    for (const k of [r.signal_key, ...(r.extra_keys ?? [])].filter(Boolean)) {
      const key = String(k).toLowerCase();
      if (!typesByKey.has(key)) typesByKey.set(key, new Set());
      typesByKey.get(key).add(r.source_type);
    }
  }
  return records.map(({ extra_keys, ...r }) => {
    const n = r.signal_key ? typesByKey.get(String(r.signal_key).toLowerCase())?.size ?? 1 : 1;
    let { confidence, caveat } = r;
    if (["language", "infrastructure"].includes(r.category) && n >= 2 && confidence !== "high" && r.source_type !== "third_party") {
      confidence = "high";
      caveat = `${caveat} Corroborated by ${n} source types.`;
    }
    if (r.freshness === "stale" && confidence === "high") confidence = "medium";
    return { ...r, confidence, caveat };
  });
}

/** §8 "Research gaps" and §13 failure handling — what we could NOT verify this run. */
export function researchGaps(company, { github, jobs, web }, evidence) {
  const gaps = [];
  const has = (keys) => evidence.some((e) => keys.includes(String(e.signal_key).toLowerCase()));

  if (github?.error) gaps.push({ area: "Public code", detail: `GitHub couldn't be read this run (${github.error}); showing the last known code evidence.` });
  else if (!github) gaps.push({ area: "Public code", detail: company.github_org ? `No GitHub account "${company.github_org}" found.` : "No company GitHub account found or confirmed. Add github_org to include public code." });
  else {
    if (github.match === "name_only") gaps.push({ area: "Company match", detail: `GitHub account "${github.login}" was matched by name only. Add the company website to confirm it.` });
    if (github.activity.active_repos < 3) gaps.push({ area: "Public code", detail: `Only ${github.activity.active_repos} active public repos; code signals may not represent the main product.` });
  }

  if (jobs?.error) gaps.push({ area: "Hiring", detail: `The job board couldn't be read this run (${jobs.error}).` });
  else if (!jobs) gaps.push({ area: "Hiring", detail: "No public job board found (Greenhouse, Lever or Ashby). Set job_board to include hiring signals." });
  else if (jobs.guessed) gaps.push({ area: "Hiring", detail: `Job board "${jobs.board}" was auto-detected by name; confirm it belongs to this company.` });

  if (web?.error) gaps.push({ area: "Blogs & talks", detail: `Web research failed this run (${web.error}).` });
  else if (!web?.findings?.length) gaps.push({ area: "Blogs & talks", detail: "No recent engineering blog posts or talks could be verified via Google Search this week." });

  if (!has(["aws", "gcp", "azure", "cloudflare"])) gaps.push({ area: "Cloud", detail: "No public evidence of which cloud provider they use." });
  if (!has(["kubernetes", "docker", "helm", "serverless"])) gaps.push({ area: "Runtime", detail: "No public evidence of container or orchestration tooling." });

  return gaps;
}

/**
 * §13 "Gemini output has unsupported claim": any technology or language named in the text that
 * isn't backed by an evidence record (the seller's own product terms are allowed).
 */
export function unsupportedClaims(text, evidence, productPitch = "") {
  const allowed = new Set([
    ...evidence.flatMap((e) => [e.signal_key, ...detectTech(`${e.claim} ${e.excerpt ?? ""}`), ...detectLanguages(`${e.claim} ${e.excerpt ?? ""}`)]),
    ...detectTech(productPitch),
  ].filter(Boolean).map((k) => String(k).toLowerCase()));
  const mentioned = [...detectTech(text), ...detectLanguages(text)];
  return [...new Set(mentioned)].filter((k) => !allowed.has(String(k).toLowerCase())).map((k) => techLabel(k));
}

/** Evidence the AI cited, filtered to real refs; §8 requires ≥1 high/medium item for the opener. */
export function citedEvidence(ids, bundle) {
  const refs = new Set((ids ?? []).map((s) => String(s).trim().toUpperCase()));
  return bundle.filter((e) => refs.has(e.ref));
}

/** Give each record a short ID the AI can cite. Strongest evidence first. */
export function toBundle(evidence) {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...evidence]
    .sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.source_tier - b.source_tier)
    .slice(0, 40)
    .map((e, i) => ({ ...e, ref: `E${i + 1}` }));
}

function hostname(url) {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
