// Live hiring signals from public job-board APIs (source Tier 1: official job postings, no keys needed).
// job_board in Supabase looks like "greenhouse:stripe". If it's blank we try the GitHub handle
// and a slug of the company name on each board, and mark the match as auto-detected.

import { CI_PAIN_RE, detectLanguages, detectTech } from "./tech.js";

// Title must name an engineering job; team names alone are too loose ("Platforms" sales teams exist).
const ENG_TITLE_RE = /engineer|developer|\bsre\b|devops|architect|programmer|reliability|\bswe\b/i;
const NON_ENG_TITLE_RE = /account executive|sales|recruit|marketing|customer success|solutions? consultant/i;

const toIso = (v) => {
  if (!v) return null;
  const d = new Date(typeof v === "number" ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const BOARDS = {
  async greenhouse(token) {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Greenhouse ${res.status}`);
    const { jobs } = await res.json();
    return jobs.map((j) => ({
      title: j.title,
      url: j.absolute_url,
      date: toIso(j.updated_at),
      team: j.departments?.map((d) => d.name).join(", ") || null,
      text: htmlToText(decodeEntities(j.content ?? "")),
    }));
  },
  async lever(token) {
    const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Lever ${res.status}`);
    const jobs = await res.json();
    if (!Array.isArray(jobs)) return null;
    return jobs.map((j) => ({
      title: j.text,
      url: j.hostedUrl,
      date: toIso(j.createdAt),
      team: j.categories?.team ?? null,
      text: [j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain]
        .filter(Boolean)
        .join("\n"),
    }));
  },
  async ashby(token) {
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${token}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Ashby ${res.status}`);
    const { jobs } = await res.json();
    if (!Array.isArray(jobs)) return null;
    return jobs.map((j) => ({
      title: j.title,
      url: j.jobUrl,
      date: toIso(j.publishedAt ?? j.updatedAt),
      team: j.team ?? j.department ?? null,
      text: j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? ""),
    }));
  },
};

async function findBoard(company) {
  if (company.job_board) {
    const [provider, token] = company.job_board.split(":").map((s) => s.trim());
    if (!BOARDS[provider] || !token) throw new Error(`job_board must look like "greenhouse:token", "lever:token" or "ashby:token"`);
    const jobs = await BOARDS[provider](token);
    return jobs ? { provider, token, jobs, guessed: false } : null;
  }
  const slugs = [...new Set([company.github_org, slugify(company.name)].filter(Boolean).map((s) => s.toLowerCase()))];
  for (const token of slugs) {
    for (const provider of Object.keys(BOARDS)) {
      try {
        const jobs = await BOARDS[provider](token);
        if (jobs?.length) return { provider, token, jobs, guessed: true };
      } catch {
        // try the next board
      }
    }
  }
  return null;
}

/**
 * @param {{name:string, github_org?:string, job_board?:string}} company
 * @param {{intent_role_keywords:string[]}} profile
 * @returns null when no board exists; throws when a board exists but can't be read.
 */
export async function getJobSignals(company, profile) {
  const board = await findBoard(company);
  if (!board) return null;

  const eng = board.jobs.filter((j) => ENG_TITLE_RE.test(j.title) && !NON_ENG_TITLE_RE.test(j.title));
  const intentRe = new RegExp(profile.intent_role_keywords.map(escapeRe).join("|"), "i");
  const intentRoles = eng
    .filter((j) => intentRe.test(j.title))
    .filter((j, i, arr) => arr.findIndex((x) => x.title.trim() === j.title.trim()) === i);

  const tools = {};
  const langs = {};
  const painEvidence = [];
  const example = (j) => ({ title: j.title.trim(), url: j.url, date: j.date });
  for (const j of eng) {
    for (const k of new Set(detectTech(j.text))) {
      tools[k] ??= { count: 0, jobs: [] };
      tools[k].count++;
      if (tools[k].jobs.length < 3) tools[k].jobs.push(example(j));
    }
    for (const l of new Set(detectLanguages(j.text))) {
      langs[l] ??= { count: 0, jobs: [] };
      langs[l].count++;
      if (langs[l].jobs.length < 3) langs[l].jobs.push(example(j));
    }
    const m = j.text.match(CI_PAIN_RE);
    if (m && painEvidence.length < 4) painEvidence.push({ ...example(j), phrase: m[0] });
  }
  const ranked = (o) =>
    Object.entries(o).sort((a, b) => b[1].count - a[1].count).map(([name, v]) => ({ name, count: v.count, jobs: v.jobs }));

  return {
    board: `${board.provider}:${board.token}`,
    guessed: board.guessed,
    total_roles: board.jobs.length,
    total_eng_roles: eng.length,
    intent_roles: intentRoles.slice(0, 8).map(example),
    tools_mentioned: ranked(tools).slice(0, 12),
    languages_mentioned: ranked(langs).slice(0, 8),
    ci_pain: painEvidence,
  };
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
function htmlToText(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
