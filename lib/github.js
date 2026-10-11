// Live engineering signals from the GitHub REST API.
// Budget per company: 1 profile + 1 repo list + ≤12 language + ≤6 workflow calls ≈ 20 requests.

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

/** Org first, then fall back to a user account with the same handle. */
async function getOwner(handle) {
  const org = await gh(`/orgs/${encodeURIComponent(handle)}`, { allow404: true });
  if (org) return { kind: "orgs", profile: org };
  const user = await gh(`/users/${encodeURIComponent(handle)}`, { allow404: true });
  if (user) return { kind: "users", profile: user };
  throw new GitHubError(`No GitHub org or user called "${handle}". Check github_org in Supabase.`, 404);
}

export async function getGithubSignals(handle) {
  const owner = await getOwner(handle.trim().toLowerCase());
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
  const infra = new Map(); // key → Set(evidence)
  const addInfra = (key, evidence) => {
    if (!infra.has(key)) infra.set(key, new Set());
    infra.get(key).add(evidence);
  };

  langMaps.forEach((m, i) => {
    for (const [lang, n] of Object.entries(m)) {
      if (lang in NON_PROGRAMMING_LANGUAGES) {
        const implied = NON_PROGRAMMING_LANGUAGES[lang];
        if (implied) addInfra(implied, `${lang} files in ${langRepos[i].name}`);
        continue;
      }
      bytes[lang] = (bytes[lang] ?? 0) + n;
    }
  });
  const total = Object.values(bytes).reduce((a, b) => a + b, 0);
  const topLanguages = Object.entries(bytes)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, pct: total ? Math.round((n / total) * 1000) / 10 : 0 }))
    .filter((l) => l.pct >= 1)
    .slice(0, 8);

  // ── Infra / architecture hints from topics, names and descriptions ──
  for (const r of repos) {
    for (const t of r.topics ?? []) for (const k of detectTech(t)) addInfra(k, `topic "${t}" on ${r.name}`);
    for (const k of detectTech(r.name)) addInfra(k, `repo ${r.name}`);
    for (const k of detectTech(r.description)) addInfra(k, `${r.name}: "${truncate(r.description, 80)}"`);
  }
  const serviceRepos = repos.filter((r) => SERVICE_REPO_RE.test(r.name)).map((r) => r.name);

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
  if (reposWithCi) addInfra("github-actions", `${reposWithCi}/${ciRepos.length} active repos run GitHub Actions`);

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
    kind: owner.kind === "orgs" ? "org" : "user",
    profile: {
      name: owner.profile.name ?? login,
      description: owner.profile.description ?? owner.profile.bio ?? null,
      blog: owner.profile.blog || null,
      public_repos: owner.profile.public_repos,
      url: owner.profile.html_url,
    },
    topLanguages,
    infra: [...infra.entries()].map(([key, ev]) => ({ key, evidence: [...ev].slice(0, 4) })),
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
    },
    notableRepos,
  };
}

function truncate(s, n) {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
