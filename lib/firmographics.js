// Collects the raw size figures for the size check (lib/size.js): Wikidata (structured, no quota) and
// a cited Google Search (lib/gemini.js researchSize). Each figure keeps its source, or is left out.

import "server-only";
import { researchSize } from "./gemini.js";

const UA = { "User-Agent": "tech-stack-scout/1.0 (sales research tool)" };
// Wikidata currency items → ISO codes.
const CURRENCY = { Q4917: "USD", Q4916: "EUR", Q25224: "GBP", Q80524: "INR", Q8146: "JPY", Q1104069: "CAD", Q259502: "AUD", Q39099: "CNY", Q25344: "CHF", Q122922: "SEK", Q190951: "SGD", Q200294: "AED" };

const host = (u) => String(u ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

async function getJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
    if (res.ok) return res.json();
    if (res.status !== 429) return null;
    await new Promise((r) => setTimeout(r, 1500)); // Wikidata rate limit: wait once and retry
  }
  return null;
}

/** Latest dated value of a Wikidata claim (by the "point in time" qualifier). */
function latest(claims) {
  return (claims ?? [])
    .map((c) => ({ v: c.mainsnak?.datavalue?.value, t: c.qualifiers?.P585?.[0]?.datavalue?.value?.time ?? "" }))
    .filter((x) => x.v)
    .sort((a, b) => (b.t > a.t ? 1 : b.t < a.t ? -1 : 0))[0];
}

/** Employees (P1128) and revenue (P2139) from the Wikidata item whose official website matches the company's. */
export async function wikidataSize(company) {
  const domain = host(company.website);
  if (!domain) return null; // without a website we can't be sure it's the same company
  const search = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(company.name)}&language=en&type=item&limit=5&format=json`);
  const ids = (search?.search ?? []).map((h) => h.id);
  if (!ids.length) return null;
  const ents = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims|labels&languages=en&format=json`);
  const id = ids.find((x) => {
    const site = host(ents?.entities?.[x]?.claims?.P856?.[0]?.mainsnak?.datavalue?.value);
    return site && (site === domain || site.endsWith(`.${domain}`) || domain.endsWith(`.${site}`));
  });
  if (!id) return null;
  const c = ents.entities[id].claims;
  const source = { title: `Wikidata · ${ents.entities[id].labels?.en?.value ?? company.name}`, url: `https://www.wikidata.org/wiki/${id}` };
  const emp = latest(c.P1128);
  const rev = latest(c.P2139);
  const currency = rev ? CURRENCY[String(rev.v.unit ?? "").split("/").pop()] : null;
  return {
    employees: emp && Number(emp.v.amount) > 0 ? { value: Math.round(Number(emp.v.amount)), as_of: emp.t.slice(1, 5) || null, source } : null,
    revenue: rev && currency ? { amount: Number(rev.v.amount), currency, year: rev.t.slice(1, 5) || null, source } : null,
  };
}

// The size lookup must never hold up the rest of the research (Vercel's 300s limit): give up after these times.
const WIKIDATA_MS = 15_000;
const WEB_MS = 45_000;
const within = (ms, promise) => Promise.race([promise.catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);

const newer = (a, b, key = "as_of") => (!a ? b : !b ? a : String(b[key] ?? "") > String(a[key] ?? "") ? b : a);

/**
 * All size figures for one company. `known` = { company_type, open_eng_roles } from the rest of the research.
 * Never throws: a source that fails just leaves its figures unknown.
 */
export async function getFirmographics(company, known = {}) {
  const [wiki, web] = await Promise.all([within(WIKIDATA_MS, wikidataSize(company)), within(WEB_MS, researchSize(company))]);
  const type = known.company_type && known.company_type !== "unknown" ? known.company_type : web?.company_type ?? "unknown";
  return {
    employees: newer(wiki?.employees, web?.employees),
    engineers: web?.engineers ?? null,
    revenue: newer(wiki?.revenue, web?.revenue, "year"),
    funding_stage: web?.funding_stage ?? null,
    company_type: type,
    open_eng_roles: known.open_eng_roles ?? null,
    sources_checked: ["Wikidata", web ? (web.via === "google_search_openrouter" ? "Web search (backup route)" : "Google Search") : "Google Search (unavailable)"],
    checked_at: new Date().toISOString(),
  };
}

/** Size changes slowly: reuse last check for 30 days if it found anything (saves search quota). */
export function reusableSize(previous) {
  if (!previous?.checked_at) return false;
  const fresh = Date.now() - new Date(previous.checked_at).getTime() < 30 * 24 * 60 * 60 * 1000;
  const anything = previous.employees || previous.engineers || previous.revenue || previous.funding_stage;
  return fresh && Boolean(anything);
}
