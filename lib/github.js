// Live engineering signals from the GitHub REST API (source Tier 1: public code repositories).
// Budget per company: 1–3 profile lookups + 1 repo list + ≤12 language + ≤6 workflow calls ≈ 22 requests.
// Every signal keeps the URL and date it came from so it can become an evidence record.

import { detectTech, NON_PROGRAMMING_LANGUAGES } from "./tech.js";

const API = "https://api.github.com";
const LANGUAGE_REPOS = 12;
const WORKFLOW_REPOS = 6;
const DAY = 24 * 60 * 60 * 1000;
const SERVICE_REPO_RE = /(^|[-_])(service|svc|api|gateway|worker|server|daemon|proxy)s?([-_]|$)/i;

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function gh(path, { allow404 = false } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tech-stack-scout",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(`${API}${path}`, { headers, cache: "no-store" });
  if (res.status === 404 && allow404) return null;
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const when = reset ? ` (resets ${new Date(Number(reset) * 1000).toISOString()})` : "";
    throw new GitHubError(`GitHub rate limit hit${when}. Set GITHUB_TOKEN for 5,000 requests/hour.`, res.status);
  }
  if (!res.ok) throw new GitHubError(`GitHub ${res.status} for ${path}`, res.status);
  return res.json();
}

export const domainOf = (url) => {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

async function getOwner(handle) {
  const org = await gh(`/orgs/${encodeURIComponent(handle)}`, { allow404: true });
  if (org) return { kind: "orgs", profile: org };
  const user = await gh(`/users/${encodeURIComponent(handle)}`, { allow404: true });
  if (user) return { kind: "users", profile: user };
  return null;
}

/**
 * Work out which GitHub account belongs to the company (§7 step 1: avoid mixing similar names).
 * - Handle given → use it.
 * - Otherwise try the website's domain name and a slug of the company name, and accept the
 *   match only if the account's own website matches the company's domain (or no domain was given).
 * Returns { owner, handle, match: 'given' | 'domain_verified' | 'name_only' } or null.
 */
export async function resolveGithub(company) {
  if (company.github_org) {
    const owner = await getOwner(company.github_org.trim().toLowerCase());
    if (!owner) throw new GitHubError(`No GitHub org or user called "${company.github_org}".`, 404);
    return { owner, match: "given" };
  }
  const domain = company.website ? domainOf(company.website) : null;
  const candidates = [
    domain?.split(".").slice(-2, -1)[0],
    String(company.name).toLowerCase().replace(/[^a-z0-9]+/g, ""),
    String(company.name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-"),
  ].filter((s, i, a) => s && a.indexOf(s) === i);

  for (const handle of candidates) {
    const owner = await getOwner(handle);
    if (!owner || owner.kind !== "orgs") continue;
    const match = matchOwner({ name: company.name, domain }, owner.profile);
    if (match) return { owner, match };
  }
  return null;
}

/** "shopify.engineering" → "shopify", "www.stripe.com" → "stripe", "opensource.microsoft.com" → "microsoft". */
const brandOf = (domain) => {
  const parts = String(domain ?? "").split(".").filter(Boolean);
  if (parts.length < 2) return parts[0] ?? null;
  const twoPartTld = /^(co|com|org|net|gov|ac)$/.test(parts.at(-2)) && parts.at(-1).length === 2; // e.g. .co.uk
  return parts.at(twoPartTld ? -3 : -2) ?? null;
};

/**
 * Decide whether a GitHub org belongs to the company (pure, unit-tested).
 * - Empty orgs (no public repos) never match.
 * - "domain_verified": the org's website is the company's domain or a subdomain of it; or the same brand on
 *   another domain (shopify.engineering ↔ shopify.com); or a GitHub-verified org whose handle is the brand.
 * - "name_only": no website to check against, or only the handle matches. Downgraded and flagged later.
 */
export function matchOwner({ name, domain }, profile) {
  if (!profile || (profile.public_repos ?? 0) === 0) return null;
  const login = String(profile.login ?? "").toLowerCase();
  const nameSlug = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!domain) return login === nameSlug || login.replace(/-/g, "") === nameSlug ? "name_only" : null;

  const blog = domainOf(profile.blog || "");
  const brand = brandOf(domain);
  if (blog && (blog === domain || blog.endsWith(`.${domain}`) || domain.endsWith(`.${blog}`))) return "domain_verified";
  if (blog && brand && brandOf(blog) === brand && brand.length >= 4) return "domain_verified";
  if (profile.is_verified && (login === brand || login === nameSlug)) return "domain_verified";
  if (login === brand || login === nameSlug) return "name_only";
  return null;
}

export async function getGithubSignals(company) {
  const resolved = await resolveGithub(company);
  if (!resolved) return null;
  const { owner, match } = resolved;
  const login = owner.profile.login;

  const repos = (await gh(`/${owner.kind}/${login}/repos?sort=pushed&direction=desc&per_page=100&type=public`))
    .filter((r) => !r.fork && !r.archived);

  const now = Date.now();
  const age = (r) => now - new Date(r.pushed_at).getTime();
  const pushed30 = repos.filter((r) => age(r) <= 30 * DAY).length;
  const pushed90 = repos.filter((r) => age(r) <= 90 * DAY).length;

  // ── Languages: aggregate bytes across the most recently pushed repos ──
  const langRepos = repos.slice(0, LANGUAGE_REPOS);
  const langMaps = await Promise.all(
    langRepos.map((r) => gh(`/repos/${login}/${r.name}/languages`, { allow404: true }).then((m) => m ?? {}))
  );
  const bytes = {};
  const contributors = {}; // language → [{name, url, pushed_at}]
  const infra = new Map(); // key → [{text, url, date}]
  const addInfra = (key, ev) => {
    if (!infra.has(key)) infra.set(key, []);
    const list = infra.get(key);
    if (list.length < 4 && !list.some((e) => e.text === ev.text)) list.push(ev);
  };

  langMaps.forEach((m, i) => {
    const repo = langRepos[i];
    for (const [lang, n] of Object.entries(m)) {
      if (lang in NON_PROGRAMMING_LANGUAGES) {
        const implied = NON_PROGRAMMING_LANGUAGES[lang];
        if (implied) addInfra(implied, { text: `${lang} files in ${repo.name}`, url: repo.html_url, date: repo.pushed_at });
        continue;
      }
      bytes[lang] = (bytes[lang] ?? 0) + n;
      (contributors[lang] ??= []).push({ name: repo.name, url: repo.html_url, pushed_at: repo.pushed_at });
    }
  });
  const total = Object.values(bytes).reduce((a, b) => a + b, 0);
  const topLanguages = Object.entries(bytes)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, pct: total ? Math.round((n / total) * 1000) / 10 : 0, repos: contributors[name] ?? [] }))
    .filter((l) => l.pct >= 1)
    .slice(0, 8);

  // ── Infra / architecture hints from topics, names and descriptions ──
  for (const r of repos) {
    const base = { url: r.html_url, date: r.pushed_at };
    for (const t of r.topics ?? []) for (const k of detectTech(t)) addInfra(k, { ...base, text: `topic "${t}" on ${r.name}` });
    for (const k of detectTech(r.name)) addInfra(k, { ...base, text: `repo ${r.name}` });
    for (const k of detectTech(r.description)) addInfra(k, { ...base, text: `${r.name}: "${truncate(r.description, 80)}"` });
  }
  const serviceRepos = repos.filter((r) => SERVICE_REPO_RE.test(r.name)).map((r) => ({ name: r.name, url: r.html_url, date: r.pushed_at }));

  // ── CI: count GitHub Actions workflows in the most active repos ──
  const ciRepos = repos.slice(0, WORKFLOW_REPOS);
  const workflows = await Promise.all(
    ciRepos.map((r) =>
      gh(`/repos/${login}/${r.name}/contents/.github/workflows`, { allow404: true })
        .then((list) => (Array.isArray(list) ? list.filter((f) => /\.ya?ml$/.test(f.name)).length : 0))
        .catch(() => 0)
    )
  );
  const reposWithCi = workflows.filter((n) => n > 0).length;
  if (reposWithCi) {
    const first = ciRepos[workflows.findIndex((n) => n > 0)];
    addInfra("github-actions", {
      text: `${reposWithCi}/${ciRepos.length} most active repos run GitHub Actions`,
      url: `${first.html_url}/tree/HEAD/.github/workflows`,
      date: first.pushed_at,
    });
  }

  const notableRepos = [...repos.slice(0, 15)]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 6)
    .map((r) => ({
      name: r.name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      pushed_at: r.pushed_at,
      url: r.html_url,
    }));

  return {
    login,
    match,
    kind: owner.kind === "orgs" ? "org" : "user",
    profile: {
      name: owner.profile.name ?? login,
      description: owner.profile.description ?? owner.profile.bio ?? null,
      blog: owner.profile.blog || null,
      public_repos: owner.profile.public_repos,
      url: owner.profile.html_url,
    },
    topLanguages,
    infra: [...infra.entries()].map(([key, evidence]) => ({ key, evidence })),
    serviceRepos,
    ci: {
      checked: ciRepos.length,
      reposWithCi,
      workflowCount: workflows.reduce((a, b) => a + b, 0),
    },
    activity: {
      active_repos: repos.length,
      repos_pushed_30d: pushed30,
      repos_pushed_90d: pushed90,
      last_push: repos[0]?.pushed_at ?? null,
      last_push_repo: repos[0] ? { name: repos[0].name, url: repos[0].html_url } : null,
    },
    notableRepos,
  };
}

function truncate(s, n) {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
