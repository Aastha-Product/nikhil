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

let client;
function ai() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/** Free-tier keys hit 429s easily; back off and retry. */
async function generate(params, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      return await ai().models.generateContent({ model: MODEL(), ...params });
    } catch (err) {
      const status = err?.status ?? 0;
      if (i >= attempts - 1 || ![429, 500, 503].includes(status)) throw err;
      await new Promise((r) => setTimeout(r, 4000 * 2 ** i));
    }
  }
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

  let res = await ask();
  if (!res.candidates?.[0]?.groundingMetadata?.groundingChunks?.length) res = await ask();
  const chunks = (res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((c) => c.web).filter((w) => w?.uri);

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
  return wikidataProfile(company.name).catch(() => null);
}

/** Fallback: Wikidata's one-line description of the best-matching entity. Type stays "unknown". */
async function wikidataProfile(name) {
  const headers = { "User-Agent": "tech-stack-scout/1.0 (sales research tool)" };
  const res = await fetch(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=1&format=json`,
    { headers, signal: AbortSignal.timeout(5000) }
  );
  const hit = (await res.json()).search?.[0];
  if (!hit?.description) return null;
  return {
    description: `${hit.label}: ${hit.description}.`,
    industry: null,
    headquarters: null,
    founded: null,
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
    return { content: `${out.summary_paragraph_1.trim()}\n\n${out.summary_paragraph_2.trim()}`, evidence_ids: out.evidence_ids ?? [] };
  }
  return {
    content: out.outreach_line.trim().replace(/^"|"$/g, ""),
    evidence_ids: out.evidence_ids ?? [],
    needs_research: out.needs_research || null,
  };
}
