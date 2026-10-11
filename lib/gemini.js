// The only AI in this project: Gemini Flash via the official @google/genai SDK.
// 1) researchWeb  — Google Search grounding: recent eng blogs / talks / stack news, with sources.
// 2) writeIntel   — structured JSON: 2-paragraph summary, first line, talking points.

import "server-only";
import { GoogleGenAI } from "@google/genai";
import { detectTech } from "./tech.js";

const MODEL = () => process.env.GEMINI_MODEL || "gemini-flash-latest";

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

/**
 * Live web research with Google Search grounding.
 * Sources come from groundingMetadata (what Google actually returned), not from the model's text.
 */
export async function researchWeb(company) {
  const today = new Date().toISOString().slice(0, 10);
  // Anchoring on today's date and "last 12 months" pushes the model to actually search instead of
  // answering from memory; if it still skips the search, retry once.
  const ask = () =>
    generate({
      contents: `Today is ${today}. Your training data is out of date, so use Google Search to find what ${company.name}${company.website ? ` (${company.website})` : ""}
has published or presented in the LAST 12 MONTHS about how it builds software: engineering blog posts, conference talks,
and infrastructure or tooling changes (cloud, Kubernetes, CI/CD, build systems, languages, developer tooling).

Return ONLY a JSON object, no prose, in this shape:
{"findings":[{"title":"short title of the post/talk/article","date":"YYYY-MM or null","insight":"one sentence on what it reveals about how they build","technologies":["named tools/languages/clouds"]}]}
Include at most 5 findings, each supported by a search result. If nothing relevant is found return {"findings":[]}.`,
      config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
    });
  let res = await ask();
  if (!res.candidates?.[0]?.groundingMetadata?.groundingChunks?.length) res = await ask();

  let findings = [];
  try {
    findings = (parseJson(res.text).findings ?? []).slice(0, 5);
  } catch {
    findings = [];
  }
  findings = findings.map((f) => ({
    title: f.title ?? null,
    date: f.date ?? null,
    insight: f.insight ?? "",
    technologies: f.technologies ?? [],
    tech_keys: [...new Set(detectTech(`${f.insight} ${(f.technologies ?? []).join(" ")}`))],
  }));

  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .map((c) => c.web)
    .filter((w) => w?.uri)
    .map((w) => ({ title: w.title ?? w.uri, url: w.uri }))
    .filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i)
    .slice(0, 8);

  // No grounding sources = nothing verifiable; don't let ungrounded claims into the score.
  return sources.length ? { findings, sources } : { findings: [], sources: [] };
}

const INTEL_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Exactly two paragraphs separated by a blank line.",
    },
    first_line: {
      type: "string",
      description: "One outreach opening line, max ~35 words, no greeting or sign-off.",
    },
    opener_reference: {
      type: "string",
      description: "The exact real signal the first line is built on (e.g. a repo name, language, tool or job title).",
    },
    talking_points: {
      type: "array",
      items: { type: "string" },
      description: "Exactly 3 short discovery questions or talking points for the call.",
    },
  },
  required: ["summary", "first_line", "opener_reference", "talking_points"],
};

/**
 * @param company  {name, ...}
 * @param product  product_profile row
 * @param facts    compact factual object built by refresh.js
 * @param feedback optional note when a previous opener failed verification
 */
export async function writeIntel(company, product, facts, feedback) {
  const prompt = `You are a technical research assistant for ${product.name}'s enterprise account executive.

PRODUCT: ${product.pitch}
Best fit: teams writing ${product.strong_languages.join(", ")}; on ${product.target_clouds.join("/").toUpperCase()}; running ${product.target_runtime.join(", ")}; with microservices and heavy CI.

FACTS about ${company.name}, pulled live this week from GitHub, their job board and web search
(this is the ONLY information you may use):
${JSON.stringify(facts, null, 2)}

Write:
1. summary — EXACTLY two paragraphs a sales rep should read before the first call.
   Paragraph 1: what they build and the shape of their stack (dominant languages, architecture hints, notable repos).
   Paragraph 2: their infrastructure/tooling, how actively they are building right now, and where ${product.name} fits or doesn't.
   Plain, confident prose. No bullet points. Do not invent technologies that are not in FACTS.
2. first_line — ONE opening line for outreach that references something specific and true from FACTS
   (prefer the strongest fit signal: a named repo, a language share, an infra tool, an open role, or a recent talk/post)
   and ties it naturally to why ${product.name} is worth a conversation. It must not be a fill-in-the-blank template,
   must not start with "I noticed" or "I saw", and must not use generic flattery.
3. opener_reference — the exact fact from FACTS the first line relies on, copied verbatim (e.g. the repo name or tool).
4. talking_points — exactly 3 sharp discovery questions grounded in FACTS.${feedback ? `\n\nIMPORTANT: ${feedback}` : ""}`;

  const res = await generate({
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: INTEL_SCHEMA,
      temperature: 0.6,
    },
  });

  const out = parseJson(res.text);
  if (!out.summary || !out.first_line) throw new Error("Gemini returned an incomplete result");
  return {
    summary: out.summary.trim(),
    first_line: out.first_line.trim().replace(/^"|"$/g, ""),
    opener_reference: out.opener_reference?.trim() ?? null,
    talking_points: (out.talking_points ?? []).slice(0, 3),
  };
}
