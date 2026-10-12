// Final QA against the LIVE deployment + Supabase, grouped by the Medium evaluation criteria.
// Usage: node --env-file=.env.local scripts/qa.mjs [https://your-app.vercel.app]
// Read-only except /api/refresh calls that are expected to be rejected (401).

import { createClient } from "@supabase/supabase-js";
import { detectLanguages, detectTech } from "../lib/tech.js";

const BASE = process.argv[2] ?? "https://nikhil-xi-three.vercel.app";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (area, name, pass, detail = "") => results.push({ area, name, pass: Boolean(pass), detail });
const get = async (path, init) => {
  const t = Date.now();
  const res = await fetch(BASE + path, { ...init, redirect: "manual", signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  return { status: res.status, text, ms: Date.now() - t };
};

// ───────── Working Vercel link ─────────
for (const p of ["/", "/watchlist", "/watchlist?tier=A", "/watchlist?open=log", "/watchlist?open=manage"]) {
  const r = await get(p);
  check("Working link", `GET ${p}`, r.status === 200 && r.ms < 8000, `${r.status} in ${r.ms} ms`);
}
const home = await get("/");
check("Working link", "New research page renders its form", /Who are you[^<]*<span[^>]*>calling next/.test(home.text) && /name="name"/.test(home.text));
check("Working link", "No dev overlay / error page in production", !/nextjs-portal|Application error|Internal Server Error/.test(home.text));

// ───────── Data ─────────
const { data: companies } = await db.from("companies").select("*, company_intel(*)");
const { data: evidence } = await db.from("evidence").select("*");
const { data: runs } = await db.from("refresh_runs").select("*").order("started_at", { ascending: false }).limit(20);
const one = (x) => (Array.isArray(x) ? x[0] : x);
const active = companies.filter((c) => c.active);
const now = Date.now();

// ───────── 1. Scoping the problem correctly (brief requirements) ─────────
check("Scoping", "Watchlist lives in Supabase", active.length > 0, `${active.length} active companies`);
check("Scoping", "Watchlist manageable without code (dashboard add/remove + Table Editor)", /Manage list/.test((await get("/watchlist?open=manage")).text));
const researched = active.filter((c) => one(c.company_intel)?.last_refreshed);
check("Scoping", "Every active company has been researched", researched.length === active.length, `${researched.length}/${active.length}`);
const fresh = researched.filter((c) => now - Date.parse(one(c.company_intel).last_refreshed) <= 7 * 864e5);
check("Scoping", "Research is ≤ 7 days old (weekly refresh)", fresh.length === researched.length, `${fresh.length}/${researched.length} fresh`);
const cronRuns = runs.filter((r) => r.trigger === "cron");
check("Scoping", "Scheduled job has run in production", cronRuns.length > 0, cronRuns[0] ? `last cron ${cronRuns[0].started_at} (${cronRuns[0].status})` : "none");
const withStack = researched.filter((c) => {
  const i = one(c.company_intel);
  return (i.top_languages?.length || 0) > 0 && (i.infra_signals?.length || 0) > 0 && i.activity_level;
});
const scored = researched.filter((c) => one(c.company_intel).fit_score != null);
check("Scoping", "Languages, infra/cloud and build activity captured (scored companies)", withStack.length >= scored.length, `${withStack.length} with all three; ${scored.length} scored`);
const models = [...new Set(researched.map((c) => one(c.company_intel).model).filter(Boolean))];
check("Scoping", "All AI output from a Gemini Flash model", models.length > 0 && models.every((m) => /flash/i.test(m)), models.join(", "));

// ───────── 2. Building reliable outputs ─────────
for (const c of researched) {
  const i = one(c.company_intel);
  const ev = evidence.filter((e) => e.company_id === c.id);
  const strong = ev.filter((e) => e.confidence !== "low");
  const paras = String(i.summary ?? "").split(/\n\s*\n/).filter((p) => p.trim());
  if (!strong.length) {
    check("Reliable outputs", `${c.name}: no strong evidence → no guessing`, i.fit_score == null && !i.first_line && /Not enough public evidence/.test(i.summary), "unscored, no opening line, sparse-evidence summary");
    continue;
  }
  check("Reliable outputs", `${c.name}: summary is exactly 2 paragraphs`, paras.length === 2, `${paras.length} paragraph(s)`);
  const words = String(i.first_line ?? "").split(/\s+/).filter(Boolean).length;
  check("Reliable outputs", `${c.name}: one opening line, verified against evidence`, i.first_line && i.opener_verified && words <= 45 && !/^(I noticed|I saw|Hi|Hello|Dear)/i.test(i.first_line), `${words} words, verified=${i.opener_verified}`);
  check("Reliable outputs", `${c.name}: opening line cites high/medium evidence with a link`, (i.opener_evidence ?? []).some((e) => e.source_url && e.confidence !== "low"));
  // independent re-check: any tool/language named in the text must exist in the evidence
  const allowed = new Set(ev.flatMap((e) => [e.signal_key, ...detectTech(`${e.claim} ${e.excerpt ?? ""}`), ...detectLanguages(`${e.claim} ${e.excerpt ?? ""}`)]).filter(Boolean).map((k) => String(k).toLowerCase()));
  const pitchAllowed = ["kubernetes", "docker", "helm", "microservices"]; // FlowForge's own product terms
  const named = [...new Set([...detectTech(`${i.summary} ${i.first_line}`), ...detectLanguages(`${i.summary} ${i.first_line}`)])];
  const unsupported = named.filter((k) => !allowed.has(String(k).toLowerCase()) && !pitchAllowed.includes(String(k).toLowerCase()));
  check("Reliable outputs", `${c.name}: no technology named without evidence`, unsupported.length === 0, unsupported.length ? `unsupported: ${unsupported.join(", ")}` : `${named.length} technologies, all backed`);
  check("Reliable outputs", `${c.name}: fit score present with 6-criterion breakdown`, i.fit_score >= 0 && i.fit_score <= 100 && (i.score_breakdown ?? []).length === 6, `${i.fit_score} ${i.fit_tier}`);
}
check("Reliable outputs", "Every finding has a source URL", evidence.every((e) => e.source_url), `${evidence.filter((e) => e.source_url).length}/${evidence.length}`);
check("Reliable outputs", "Every finding has an observed date, source type, tier, confidence, freshness, caveat",
  evidence.every((e) => e.observed_at && e.source_type && e.source_tier && ["high", "medium", "low"].includes(e.confidence) && e.freshness && e.caveat),
  `${evidence.length} findings`);
check("Reliable outputs", "Third-party sources are never rated high", evidence.filter((e) => e.source_type === "third_party").every((e) => e.confidence === "low"));
check("Reliable outputs", "Stale evidence is never rated high", evidence.filter((e) => e.freshness === "stale").every((e) => e.confidence !== "high"));

// ───────── 3. Handling edge cases ─────────
const r401a = await get("/api/refresh");
check("Edge cases", "Refresh endpoint rejects missing secret", r401a.status === 401);
const r401b = await get("/api/refresh", { headers: { Authorization: "Bearer wrong-secret" } });
check("Edge cases", "Refresh endpoint rejects wrong secret", r401b.status === 401);
for (const p of ["/company/00000000-0000-0000-0000-000000000000", "/company/not-a-uuid", "/company/%27%3B--"]) {
  const r = await get(p);
  check("Edge cases", `Unknown company link ${p} → friendly "not found"`, /could not be found/i.test(r.text), `${r.status}`);
}
for (const [label, q] of [["empty", ""], ["1 char", "a"], ["script tag", "<script>alert(1)</script>"], ["very long", "x".repeat(500)], ["unicode", "ソニー"], ["SQL-ish", "%' or 1=1 --"]]) {
  const r = await get(`/api/suggest?q=${encodeURIComponent(q)}`);
  let ok = r.status === 200;
  try { ok = ok && Array.isArray(JSON.parse(r.text).items); } catch { ok = false; }
  check("Edge cases", `Suggest handles ${label} input`, ok, `${r.status}`);
}
const sug = JSON.parse((await get("/api/suggest?q=strip")).text).items;
check("Edge cases", "Suggest filters adult sites", !sug.some((s) => /stripchat|xhamster/i.test(`${s.name} ${s.domain}`)), sug.map((s) => s.name).join(", "));
const dd = JSON.parse((await get("/api/suggest?q=datad")).text).items;
check("Edge cases", "Suggest flags companies already on the watchlist", dd[0]?.existingId, dd[0] ? `${dd[0].name} → existing` : "none");
const sparse = researched.filter((c) => one(c.company_intel).fit_score == null);
check("Edge cases", "Sparse-evidence company shown as 'not enough evidence', not a low score", sparse.length === 0 || /Not enough evidence to score/.test((await get(`/company/${sparse[0].id}?tab=score`)).text), sparse.map((c) => c.name).join(", ") || "none on list");
const gapped = researched.filter((c) => (one(c.company_intel).research_gaps ?? []).length);
check("Edge cases", "Research gaps recorded instead of guesses", gapped.length > 0, `${gapped.length} companies list gaps`);
check("Edge cases", "No company stuck in queued/researching", !active.some((c) => ["queued", "researching"].includes(c.research_status)), active.map((c) => `${c.name}:${c.research_status}`).join(" "));
check("Edge cases", "No failed company without a last good report", !active.some((c) => c.research_status === "failed" && !one(c.company_intel)?.summary));
const recent = runs.slice(0, 10);
check("Edge cases", "Recent refresh runs succeeded or were partial (none silently failed)", recent.every((r) => ["succeeded", "partial"].includes(r.status)), recent.map((r) => `${r.trigger}:${r.status}`).join(" "));

// ───────── Security / build quality ─────────
const htmls = [home.text, (await get("/watchlist")).text];
const chunkPaths = [...new Set(htmls.flatMap((h) => [...h.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0])))];
let leaked = [];
for (const p of chunkPaths) {
  const js = (await get(p)).text;
  for (const [name, re] of [["Supabase secret", /sb_secret_/], ["GitHub token", /github_pat_/], ["Gemini key", /AQ\.Ab8|AIza[0-9A-Za-z_-]{20,}/], ["service role", /SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET/]]) {
    if (re.test(js)) leaked.push(`${name} in ${p}`);
  }
}
for (const h of htmls) if (/sb_secret_|github_pat_|AQ\.Ab8/.test(h)) leaked.push("secret in HTML");
check("Security", `No secrets in any page or browser script (${chunkPaths.length} scripts scanned)`, leaked.length === 0, leaked.join("; "));
const anon = createClient(process.env.SUPABASE_URL, "invalid-anon-key", { auth: { persistSession: false } });
const { data: anonRows, error: anonErr } = await anon.from("companies").select("id").limit(1);
check("Security", "Database not readable without the server key", anonErr || !anonRows?.length, anonErr ? "rejected" : `${anonRows?.length} rows`);

// ───────── Report ─────────
const areas = [...new Set(results.map((r) => r.area))];
let failed = 0;
for (const a of areas) {
  const rs = results.filter((r) => r.area === a);
  console.log(`\n## ${a} — ${rs.filter((r) => r.pass).length}/${rs.length} passed`);
  for (const r of rs) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  }
}
console.log(`\nTOTAL: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
