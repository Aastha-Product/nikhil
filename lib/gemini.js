// The only AI in this project: Gemini Flash via the official @google/genai SDK.
// 1) researchWeb     — Google Search grounding: discovers recent eng blogs / talks, with real source URLs.
// 2) writeReport     — structured JSON from the evidence bundle: 2 paragraphs, first line, talking points,
//                      each citing evidence IDs (architecture doc §8).
// 3) rewriteOutput   — regenerate one output (optionally with Nikhil's feedback) from the SAME evidence (§9).
// Gemini never decides confidence or the fit score; code does.

import "server-only";
import { GoogleGenAI } from "@google/genai";
import { detectTech } from "./tech.js";

export const MODEL = () => process.env.GEMINI_MODEL || "gemini-flash-latest";
const BACKUP_MODEL = () => process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";
const OPENROUTER_MODEL = () => process.env.OPENROUTER_MODEL || "google/gemini-3.7-flash";

let client;
function ai() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Worth trying another route for: rate limits/quota, server errors, model gone, key/permission, network.
const isRetryable = (err) => [429, 500, 502, 503, 504].includes(err?.status ?? 0);
const shouldFallBack = (err) =>
  !err?.status ||
  isRetryable(err) ||
  [401, 403, 404].includes(err.status) ||
  (err.status === 400 && /api key|API_KEY_INVALID|expired|permission/i.test(String(err.message))); // revoked/invalid key

async function viaGoogle(model, params, attempts) {
  for (let i = 0; ; i++) {
    try {
      const res = await ai().models.generateContent({ model, ...params });
      res.servedBy = res.modelVersion || model;
      return res;
    } catch (err) {
      if (i >= attempts - 1 || !isRetryable(err)) throw err;
      await sleep(3000 * 2 ** i);
    }
  }
}

/**
 * Last-resort route: the same Gemini Flash family through OpenRouter, restricted to Google's own
 * servers (no other vendor can answer). Plain text / JSON only — no Google Search grounding.
 */
async function viaOpenRouter(params, attempts = 3) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw Object.assign(new Error("No OpenRouter fallback key configured"), { status: 0 });
  const cfg = params.config ?? {};
  const body = {
    model: OPENROUTER_MODEL(),
    messages: [{ role: "user", content: String(params.contents) }],
    temperature: cfg.temperature,
    provider: { only: ["google-vertex", "google-ai-studio"], allow_fallbacks: false },
  };
  if (cfg.responseJsonSchema) body.response_format = { type: "json_schema", json_schema: { name: "output", strict: false, schema: cfg.responseJsonSchema } };
  else if (cfg.responseMimeType === "application/json") body.response_format = { type: "json_object" };

  for (let i = 0; ; i++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.choices?.[0]?.message?.content) {
      return { text: json.choices[0].message.content, candidates: [], servedBy: `openrouter:${json.model ?? body.model}` };
    }
    const err = Object.assign(new Error(`OpenRouter ${res.status}: ${json.error?.message ?? "no content"}`), { status: res.status });
    if (res.status === 402 || i >= attempts - 1 || !isRetryable(err)) throw err; // 402 = out of credits: stop
    await sleep(2000 * 2 ** i);
  }
}

/**
 * Every Gemini call goes through here. Text/JSON calls fall back in order:
 *   1) GEMINI_MODEL on the Google AI Studio key (retries with back-off)
 *   2) GEMINI_FALLBACK_MODEL on the same key (a second Flash model has its own quota)
 *   3) OPENROUTER_MODEL via OpenRouter, Google servers only
 * Google Search calls (tools) stay on Google's API: they need Google's source links; if they fail,
 * the callers' own fallbacks apply (company website, Wikidata, last good evidence).
 */
async function generate(params) {
  const grounded = Boolean(params.config?.tools?.length);
  let lastErr;
  try {
    return await viaGoogle(MODEL(), params, 3);
  } catch (err) {
    lastErr = err;
    if (grounded || !shouldFallBack(err)) throw err;
  }
  if (BACKUP_MODEL() && BACKUP_MODEL() !== MODEL()) {
    try {
      return await viaGoogle(BACKUP_MODEL(), params, 2);
    } catch (err) {
      lastErr = err;
      if (!shouldFallBack(err)) throw err;
    }
  }
  if (process.env.OPENROUTER_API_KEY) return viaOpenRouter(params);
  throw lastErr;
}

function parseJson(text) {
  const cleaned = String(text ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.search(/[[{]/);
  return JSON.parse(start > 0 ? cleaned.slice(start) : cleaned);
}

/** Grounding links are short-lived Google redirects; resolve them to the real page URL. */
async function resolveRedirect(uri) {
  try {
    const res = await fetch(uri, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
    const loc = res.headers.get("location");
    return loc && /^https?:\/\//.test(loc) ? loc : uri;
  } catch {
    return uri;
  }
}

const WEB_TYPES = ["engineering_blog", "conference_talk", "docs", "company_news", "third_party"];

/**
 * Live web research with Google Search grounding (discovery, §5).
 * Each finding is linked to an actual search result; findings with no matching result are dropped.
 */
export async function researchWeb(company) {
  const today = new Date().toISOString().slice(0, 10);
  // Anchoring on today's date and "last 12 months" pushes the model to actually search instead of
  // answering from memory; if it still skips the search, retry once.
  const ask = () =>
    generate({
      contents: `Today is ${today}. Your training data is out of date, so use Google Search to find what ${company.name}${company.website ? ` (${company.website})` : ""}
has published or presented in the LAST 12 MONTHS about how it builds software: engineering blog posts, conference talks by its engineers,
technical docs, and infrastructure or tooling changes (cloud, Kubernetes, CI/CD, build systems, languages, developer tooling).

Return ONLY a JSON object, no prose, in this shape:
{"findings":[{"title":"exact title of the post/talk/page","date":"YYYY-MM or null","type":"engineering_blog | conference_talk | docs | company_news | third_party","source_domain":"domain of the page, e.g. stripe.com","published_by_company":true or false (is the page published by ${company.name} itself or its parent company?),"insight":"one sentence on what it says about how they build","technologies":["named tools/languages/clouds"]}]}
Include at most 5 findings, each taken from a search result you actually opened. If nothing relevant is found return {"findings":[]}.`,
      config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
    });
  let res = await ask();
  if (!res.candidates?.[0]?.groundingMetadata?.groundingChunks?.length) res = await ask();

  const meta = res.candidates?.[0]?.groundingMetadata;
  const chunks = (meta?.groundingChunks ?? []).map((c) => c.web).filter((w) => w?.uri);
  if (!chunks.length) return { findings: [], sources: [], grounded: false };

  let raw = [];
  try {
    raw = (parseJson(res.text).findings ?? []).slice(0, 5);
  } catch {
    raw = [];
  }

  // Map each finding to the search result it came from: first via groundingSupports (text spans → chunks),
  // then by matching the stated domain against the chunk titles (Google uses the domain as the title).
  const supports = meta?.groundingSupports ?? [];
  const chunkFor = (f) => {
    const needles = [f.title, f.insight].filter(Boolean).map((s) => String(s).slice(0, 40).toLowerCase());
    for (const s of supports) {
      const seg = String(s.segment?.text ?? "").toLowerCase();
      if (needles.some((n) => n.length > 12 && seg.includes(n)) && s.groundingChunkIndices?.length) return chunks[s.groundingChunkIndices[0]];
    }
    const dom = String(f.source_domain ?? "").toLowerCase().replace(/^www\./, "");
    return dom ? chunks.find((c) => String(c.title ?? "").toLowerCase().replace(/^www\./, "") === dom) : null;
  };

  // Resolve every grounding link once, in parallel (they're slow redirects).
  const top = chunks.slice(0, 8);
  const resolved = new Map(await Promise.all(chunks.map(async (c) => [c.uri, await resolveRedirect(c.uri)])));

  const findings = [];
  for (const f of raw) {
    const chunk = chunkFor(f);
    if (!chunk) continue; // unverifiable → not evidence
    findings.push({
      title: f.title ?? null,
      date: f.date ?? null,
      type: WEB_TYPES.includes(f.type) ? f.type : "third_party",
      domain: String(chunk.title ?? f.source_domain ?? "").toLowerCase().replace(/^www\./, ""),
      url: resolved.get(chunk.uri) ?? chunk.uri,
      first_party: f.published_by_company === true,
      insight: f.insight ?? "",
      technologies: f.technologies ?? [],
      tech_keys: [...new Set(detectTech(`${f.insight} ${(f.technologies ?? []).join(" ")}`))],
    });
  }

  const sources = top.map((c) => ({ title: c.title ?? c.uri, url: resolved.get(c.uri) ?? c.uri }));
  return { findings, sources: sources.filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i), grounded: true };
}

// ─────────────────────────── Company context (used when there's no engineering evidence) ───────────────────────────

const COMPANY_TYPES = ["software", "tech_enabled", "non_software", "unknown"];

/**
 * Who is this company? One grounded call, used only when research found no strong engineering evidence,
 * so Nikhil sees why (e.g. a consumer brand) instead of an empty page. Falls back to Wikidata.
 * Returns { description, industry, headquarters, founded, company_type, type_reason, sources[], via } or null.
 */
export async function profileCompany(company) {
  const ask = () =>
    generate({
      contents: `Use Google Search to identify the company "${company.name}"${company.website ? ` (website: ${company.website})` : ""}.
Return ONLY a JSON object, no prose:
{"description":"one or two plain sentences on what the company does and sells","industry":"short industry name","headquarters":"city, country or null","founded":"year or null","company_type":"software | tech_enabled | non_software | unknown","type_reason":"one short sentence explaining the type"}
Definitions:
- software: its main product is software, an internet platform or developer/IT tooling.
- tech_enabled: its main product isn't software, but it clearly runs a large in-house software organisation (e.g. a big online marketplace, a fintech).
- non_software: consumer goods, hardware brands, manufacturing, retail, services, education, healthcare providers, etc., with no clear evidence of a large in-house software team.
- unknown: if the search results don't make it clear.
Only use facts supported by the search results.`,
      config: { tools: [{ googleSearch: {} }], temperature: 0.1 },
    });

  // Google Search grounding has its own daily quota; if it's used up, fall back to Wikidata below.
  let res = null;
  try {
    res = await ask();
    if (!res.candidates?.[0]?.groundingMetadata?.groundingChunks?.length) res = await ask();
  } catch {
    res = null;
  }
  const chunks = (res?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((c) => c.web).filter((w) => w?.uri);

  if (chunks.length) {
    try {
      const p = parseJson(res.text);
      if (p.description) {
        const sources = await Promise.all(chunks.slice(0, 4).map(async (c) => ({ title: c.title ?? "source", url: await resolveRedirect(c.uri) })));
        return {
          description: String(p.description).trim(),
          industry: p.industry || null,
          headquarters: p.headquarters && p.headquarters !== "null" ? p.headquarters : null,
          founded: p.founded && p.founded !== "null" ? String(p.founded) : null,
          company_type: COMPANY_TYPES.includes(p.company_type) ? p.company_type : "unknown",
          type_reason: p.type_reason || null,
          sources,
          via: "google_search",
        };
      }
    } catch {
      // fall through to Wikidata
    }
  }
  // Fallbacks that need no search quota: the company's own website (first-party), then Wikidata.
  const base = (await websiteProfile(company).catch(() => null)) ?? (await wikidataProfile(company).catch(() => null));
  if (!base) return null;
  return classifyFromText(base);
}

/** Classify from the cited text only (a plain call, no search quota needed). */
async function classifyFromText(wiki) {
  try {
    const c = await generate({
      contents: `Classify this company using ONLY the description below (from ${wiki.via === "company_website" ? "the company's own website" : "Wikidata"}). Do not use outside knowledge.
Description: "${wiki.description}"
Return ONLY JSON: {"industry":"short industry name or null","company_type":"software | tech_enabled | non_software | unknown","type_reason":"one short sentence citing the description"}
- software: main product is software, an internet platform or IT tooling.
- tech_enabled: main product isn't software but the description shows a large technology/online operation.
- non_software: consumer goods, hardware brands, manufacturing, retail, services, education, healthcare, etc.
- unknown: the description doesn't say enough.`,
      config: { responseMimeType: "application/json", temperature: 0 },
    });
    const p = parseJson(c.text);
    return {
      ...wiki,
      industry: p.industry && p.industry !== "null" ? p.industry : wiki.industry,
      company_type: COMPANY_TYPES.includes(p.company_type) ? p.company_type : "unknown",
      type_reason: p.type_reason || null,
    };
  } catch {
    return wiki;
  }
}

/** Fallback: the company's own homepage title and meta description (first-party, Tier 1). */
async function websiteProfile(company) {
  if (!company.website) return null;
  const res = await fetch(company.website, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TechStackScout/1.0; sales research)" },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "html")) return null;
  // Only the <head> matters; read at most ~300 KB.
  const reader = res.body.getReader();
  let html = "";
  const dec = new TextDecoder();
  while (html.length < 300_000) {
    const { value, done } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  reader.cancel().catch(() => {});
  const pick = (re) => (html.match(re) ?? [])[1];
  const clean = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&#8217;/g, "’").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const title = clean(pick(/<title[^>]*>([^<]{3,200})<\/title>/i));
  const desc = clean(
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,400})/i) ??
      pick(/<meta[^>]+content=["']([^"']{10,400})["'][^>]+name=["']description/i) ??
      pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,400})/i)
  );
  if (!title && !desc) return null;
  return {
    description: [title, desc].filter(Boolean).join(". ").replace(/\.\./g, "."),
    industry: null,
    headquarters: null,
    founded: null,
    company_type: "unknown",
    type_reason: null,
    sources: [{ title: title || company.website, url: company.website }],
    via: "company_website",
  };
}

/**
 * Fallback: Wikidata entity for the company. Prefers the result whose official website matches the
 * company's domain; otherwise the first result that is described as an organisation.
 */
async function wikidataProfile(company) {
  const headers = { "User-Agent": "tech-stack-scout/1.0 (sales research tool)" };
  const get = async (url) => (await fetch(url, { headers, signal: AbortSignal.timeout(6000) })).json();
  const search = await get(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(company.name)}&language=en&type=item&limit=5&format=json`
  );
  const hits = (search.search ?? []).filter((h) => h.description);
  if (!hits.length) return null;
  const ents = await get(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hits.map((h) => h.id).join("|")}&props=claims&format=json`
  );
  const host = (u) => String(u ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const domain = host(company.website);
  const siteOf = (id) => host(ents.entities?.[id]?.claims?.P856?.[0]?.mainsnak?.datavalue?.value);
  const orgRe = /company|brand|business|manufacturer|organi[sz]ation|enterprise|firm|school|university|college|startup|corporation|group|retailer|provider|service/i;
  const hit =
    (domain && hits.find((h) => siteOf(h.id) && (siteOf(h.id) === domain || siteOf(h.id).endsWith(`.${domain}`) || domain.endsWith(`.${siteOf(h.id)}`)))) ||
    hits.find((h) => orgRe.test(h.description));
  if (!hit) return null;
  const inception = ents.entities?.[hit.id]?.claims?.P571?.[0]?.mainsnak?.datavalue?.value?.time;
  return {
    description: `${hit.label}: ${hit.description.charAt(0).toUpperCase()}${hit.description.slice(1)}.`,
    industry: null,
    headquarters: null,
    founded: inception ? inception.slice(1, 5) : null,
    company_type: "unknown",
    type_reason: null,
    sources: [{ title: `Wikidata · ${hit.label}`, url: `https://www.wikidata.org/wiki/${hit.id}` }],
    via: "wikidata",
  };
}

// ─────────────────────────── Report generation ───────────────────────────

const RULES = (product) => `RULES (from the Tech Stack Scout architecture, §8):
- Use ONLY the evidence items provided. Every technology, number or claim you mention must come from an evidence item.
- Cite evidence by ID (e.g. "E4"). Prefer high- and medium-confidence evidence.
- Distinguish what is directly stated or observed from what is inferred ("their job posts ask for…", "public repos show…").
- Do NOT claim to know private projects, internal architecture, business pain, budget, or buying intent.
- Mention recency when it matters (e.g. "a 2025 talk", "roles posted this month").
- If evidence is sparse, say so plainly instead of padding.
- The seller: ${product.name}. ${product.pitch}`;

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    summary_paragraph_1: { type: "string", description: "Observable stack: strongest language and infrastructure findings and where they came from." },
    summary_paragraph_2: { type: "string", description: "Engineering activity and implications: recent build and hiring signals, technical priorities, why they may matter to the seller, with inferences qualified." },
    summary_evidence_ids: { type: "array", items: { type: "string" } },
    outreach_line: { type: "string", description: "One natural sentence, max ~35 words, anchored to a high- or medium-confidence evidence item." },
    outreach_evidence_ids: { type: "array", items: { type: "string" }, description: "IDs of the evidence the line relies on (at least one)." },
    talking_points: { type: "array", items: { type: "string" }, description: "Exactly 3 discovery questions grounded in the evidence." },
  },
  required: ["summary_paragraph_1", "summary_paragraph_2", "summary_evidence_ids", "outreach_line", "outreach_evidence_ids", "talking_points"],
};

function bundleText(bundle) {
  return bundle
    .map((e) => `${e.ref} [${e.category} · ${e.confidence} confidence · ${e.evidence_status.replace("_", " ")} · ${e.source_type.replace("_", " ")}${e.source_date ? ` · ${e.source_date.slice(0, 10)}` : ""}] ${e.claim}`)
    .join("\n");
}

/**
 * @param company   {name}
 * @param product   product_profile row
 * @param bundle    evidence items with a `ref` ("E1"…), from lib/evidence.js
 * @param context   {fit, gaps}
 * @param feedback  optional correction when a previous attempt failed validation
 */
export async function writeReport(company, product, bundle, context, feedback) {
  const prompt = `You are a technical research assistant preparing ${product.name}'s account executive for a first sales call with ${company.name}.

${RULES(product)}

EVIDENCE (collected live this week; IDs are stable for this report):
${bundleText(bundle)}

RESEARCH GAPS (things we could not verify): ${context.gaps.length ? context.gaps.map((g) => g.detail).join("; ") : "none"}
FIT ASSESSMENT (computed in code): ${context.fit}

WRITE:
1. summary_paragraph_1 and summary_paragraph_2 — exactly two concise paragraphs for a sales rep (not an engineer). No bullet points.
2. outreach_line — ONE sentence that references a specific, verified signal and connects it to why ${product.name} may be worth a conversation,
   without claiming they have a problem. No greeting, no flattery, must not start with "I noticed" or "I saw", not a template.
3. outreach_evidence_ids — the evidence IDs the line is built on.
4. talking_points — exactly 3 discovery questions grounded in the evidence.${feedback ? `\n\nIMPORTANT CORRECTION: ${feedback}` : ""}`;

  const res = await generate({
    contents: prompt,
    config: { responseMimeType: "application/json", responseJsonSchema: REPORT_SCHEMA, temperature: 0.5 },
  });
  const out = parseJson(res.text);
  if (!out.summary_paragraph_1 || !out.outreach_line) throw new Error("Gemini returned an incomplete report");
  return {
    paragraphs: [out.summary_paragraph_1.trim(), out.summary_paragraph_2.trim()],
    summary_evidence_ids: out.summary_evidence_ids ?? [],
    first_line: out.outreach_line.trim().replace(/^"|"$/g, ""),
    outreach_evidence_ids: out.outreach_evidence_ids ?? [],
    talking_points: (out.talking_points ?? []).slice(0, 3),
    model: res.servedBy ?? MODEL(),
  };
}

const REWRITE_SCHEMA = {
  summary: {
    type: "object",
    properties: {
      summary_paragraph_1: { type: "string" },
      summary_paragraph_2: { type: "string" },
      evidence_ids: { type: "array", items: { type: "string" } },
    },
    required: ["summary_paragraph_1", "summary_paragraph_2", "evidence_ids"],
  },
  first_line: {
    type: "object",
    properties: {
      outreach_line: { type: "string" },
      evidence_ids: { type: "array", items: { type: "string" } },
      needs_research: { type: "string", description: "If the feedback asks for a fact not in the evidence, say what is missing; else empty." },
    },
    required: ["outreach_line", "evidence_ids"],
  },
};

/** Regenerate one output from the same evidence (§9). Never adds facts that aren't in the evidence. */
export async function rewriteOutput(type, company, product, bundle, current, feedback) {
  const what = type === "summary"
    ? "the two-paragraph engineering summary (paragraph 1: observable stack; paragraph 2: activity and implications)"
    : "the one-sentence outreach opening line";
  const prompt = `You are revising ${what} for ${company.name}, for ${product.name}'s account executive.

${RULES(product)}

EVIDENCE:
${bundleText(bundle)}

CURRENT VERSION:
${current}

${feedback ? `THE REP'S FEEDBACK: "${feedback}"\nApply it only if the evidence supports it. If it needs a fact that is not in the evidence, keep the claim out and explain the gap in needs_research.` : "Write a fresh alternative version with different wording, using the same evidence."}`;

  const res = await generate({
    contents: prompt,
    config: { responseMimeType: "application/json", responseJsonSchema: REWRITE_SCHEMA[type], temperature: 0.8 },
  });
  const out = parseJson(res.text);
  if (type === "summary") {
    return { content: `${out.summary_paragraph_1.trim()}\n\n${out.summary_paragraph_2.trim()}`, evidence_ids: out.evidence_ids ?? [], model: res.servedBy ?? MODEL() };
  }
  return {
    content: out.outreach_line.trim().replace(/^"|"$/g, ""),
    evidence_ids: out.evidence_ids ?? [],
    needs_research: out.needs_research || null,
    model: res.servedBy ?? MODEL(),
  };
}
