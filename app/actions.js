"use server";

// Dashboard mutations. Each one is a public POST endpoint, so every input is validated here.
// Watchlist edits write to Supabase (the source of truth); text edits never touch evidence (§9).

import { refresh } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/supabaseAdmin";
import { getProductProfile, refreshStale } from "@/lib/refresh";
import { MODEL, rewriteOutput } from "@/lib/gemini";
import { citedEvidence, evidenceMentionedIn, toBundle, unsupportedClaims } from "@/lib/evidence";

const STATUSES = ["not_contacted", "contacted", "replied", "meeting", "won", "lost"];
const MIN_REFRESH_GAP_MS = 10 * 60 * 1000; // stop the public "Refresh now" button from burning API quota
const MAX_ACTIVE = 30;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

// ─────────────────────────── Watchlist ───────────────────────────

export async function addCompany(_prev, formData) {
  const name = String(formData.get("name") ?? "").trim();
  const websiteRaw = String(formData.get("website") ?? "").trim();
  const githubOrg = String(formData.get("github_org") ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/.*$/, "");
  const jobBoard = String(formData.get("job_board") ?? "").trim().toLowerCase();

  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter the company name (2–80 characters)." };
  let website = null;
  if (websiteRaw) {
    try {
      const u = new URL(/^https?:\/\//i.test(websiteRaw) ? websiteRaw : `https://${websiteRaw}`);
      if (!u.hostname.includes(".")) throw new Error();
      website = `https://${u.hostname.replace(/^www\./, "")}`;
    } catch {
      return { ok: false, error: "The website doesn't look like a valid address, e.g. stripe.com." };
    }
  }
  if (githubOrg && !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(githubOrg)) return { ok: false, error: "GitHub handle can only contain letters, numbers and dashes." };
  if (jobBoard && !/^(greenhouse|lever|ashby):[a-z0-9_-]+$/.test(jobBoard)) return { ok: false, error: 'Job board must look like "greenhouse:stripe", "lever:netflix" or "ashby:linear".' };

  const normalized = normalize(name);
  const { data: existing } = await db().from("companies").select("id, active, name").eq("normalized_name", normalized).maybeSingle();
  if (existing?.active) return { ok: false, existingId: existing.id, error: `${existing.name} is already on your watchlist.` };

  const { count } = await db().from("companies").select("id", { count: "exact", head: true }).eq("active", true);
  if ((count ?? 0) >= MAX_ACTIVE) return { ok: false, error: `The watchlist is limited to ${MAX_ACTIVE} active companies.` };

  const fields = {
    name,
    normalized_name: normalized,
    website,
    github_org: githubOrg ? githubOrg.toLowerCase() : null,
    job_board: jobBoard || null,
    active: true,
    research_status: "queued",
    updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = existing
    ? await db().from("companies").update(fields).eq("id", existing.id).select("id").single()
    : await db().from("companies").insert(fields).select("id").single();
  if (error) return { ok: false, error: error.message };

  // Research starts right away, after the response is sent (§7 step 1 → "Queued").
  after(() => refreshStale({ companyId: saved.id, trigger: "added" }).catch(() => {}));
  refresh();
  return { ok: true, id: saved.id, message: `${name} added. Research is running and takes about a minute.` };
}

export async function removeCompany(companyId) {
  if (!UUID_RE.test(companyId)) return { ok: false, error: "Invalid company" };
  // Soft remove: the weekly job stops refreshing it, and its history is kept so it can be restored.
  const { error } = await db().from("companies").update({ active: false, updated_at: new Date().toISOString() }).eq("id", companyId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function restoreCompany(companyId) {
  if (!UUID_RE.test(companyId)) return { ok: false, error: "Invalid company" };
  const { count } = await db().from("companies").select("id", { count: "exact", head: true }).eq("active", true);
  if ((count ?? 0) >= MAX_ACTIVE) return { ok: false, error: `The watchlist is limited to ${MAX_ACTIVE} active companies.` };
  const { error } = await db().from("companies").update({ active: true, updated_at: new Date().toISOString() }).eq("id", companyId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function refreshNow(companyId) {
  if (!UUID_RE.test(companyId)) return { ok: false, error: "Invalid company" };
  const { data: company } = await db()
    .from("companies")
    .select("id, research_status, company_intel(last_attempted)")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return { ok: false, error: "Company not found" };
  if (company.research_status === "researching") return { ok: false, error: "Research is already running for this company." };

  const intel = Array.isArray(company.company_intel) ? company.company_intel[0] : company.company_intel;
  const last = intel?.last_attempted ? new Date(intel.last_attempted).getTime() : 0;
  if (Date.now() - last < MIN_REFRESH_GAP_MS) {
    const wait = Math.ceil((MIN_REFRESH_GAP_MS - (Date.now() - last)) / 60000);
    return { ok: false, error: `Refreshed moments ago — try again in ${wait} min.` };
  }

  const summary = await refreshStale({ companyId, trigger: "dashboard" });
  refresh();
  const r = summary.results[0];
  if (!r) return { ok: false, error: "Nothing was refreshed." };
  return r.ok ? { ok: true, partial: r.partial } : { ok: false, error: r.error };
}

export async function setOutreachStatus(companyId, status) {
  if (!UUID_RE.test(companyId) || !STATUSES.includes(status)) return { ok: false, error: "Invalid status" };
  const { error } = await db().from("companies").update({ outreach_status: status }).eq("id", companyId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

// ─────────────────────────── Edit / regenerate (§9) ───────────────────────────

const FIELD = { summary: "summary", first_line: "first_line" };

/** Re-check an edited or restored opening line against the stored evidence. */
async function reverifyLine(companyId, line) {
  const [{ data: evidence }, product] = await Promise.all([
    db().from("evidence").select("*").eq("company_id", companyId),
    getProductProfile(),
  ]);
  const backed = evidenceMentionedIn(line, evidence ?? []);
  const ok = backed.length > 0 && unsupportedClaims(line, evidence ?? [], product.pitch).length === 0;
  return {
    opener_verified: ok,
    opener_reference: backed[0]?.claim ?? null,
    opener_evidence: ok ? backed.map(({ claim, source_url, source_title, confidence }) => ({ claim, source_url, source_title, confidence })) : [],
  };
}

async function saveOutput(companyId, type, content, origin, extra = {}) {
  const intelFields = { [FIELD[type]]: content, [`${type}_origin`]: origin, ...extra.intel };
  const { error } = await db().from("company_intel").update(intelFields).eq("company_id", companyId);
  if (error) throw new Error(error.message);
  await db().from("report_versions").insert({
    company_id: companyId,
    output_type: type,
    content,
    origin,
    feedback: extra.feedback ?? null,
    model: origin.startsWith("ai") ? MODEL() : null,
  });
}

export async function saveEdit(companyId, type, content) {
  if (!UUID_RE.test(companyId) || !FIELD[type]) return { ok: false, error: "Invalid request" };
  const text = String(content ?? "").trim();
  if (text.length < 10 || text.length > 4000) return { ok: false, error: "The text must be between 10 and 4,000 characters." };
  const intel = type === "first_line" ? { intel: await reverifyLine(companyId, text) } : {};
  await saveOutput(companyId, type, text, "edited", intel);
  refresh();
  return { ok: true };
}

export async function regenerateOutput(companyId, type, feedback) {
  if (!UUID_RE.test(companyId) || !FIELD[type]) return { ok: false, error: "Invalid request" };
  const fb = String(feedback ?? "").trim().slice(0, 500);

  const [{ data: company }, { data: intel }, { data: evidence }, product] = await Promise.all([
    db().from("companies").select("id, name").eq("id", companyId).single(),
    db().from("company_intel").select("summary, first_line").eq("company_id", companyId).single(),
    db().from("evidence").select("*").eq("company_id", companyId).order("id"),
    getProductProfile(),
  ]);
  if (!evidence?.length) return { ok: false, error: "No evidence stored for this company yet. Refresh the research first." };

  // Same validated evidence as the report — regeneration can reword, never add facts (§9 safeguard).
  const bundle = toBundle(evidence);
  const out = await rewriteOutput(type, company, product, bundle, intel?.[FIELD[type]] ?? "", fb);
  const unsupported = unsupportedClaims(out.content, evidence, product.pitch);
  if (unsupported.length) {
    return { ok: false, error: `The new version mentioned ${unsupported.join(", ")}, which isn't in the evidence, so it was not saved. Try again or refresh the research.` };
  }

  const extra = { feedback: fb || null, intel: {} };
  if (type === "first_line") {
    const cited = citedEvidence(out.evidence_ids, bundle).filter((e) => e.confidence !== "low");
    extra.intel = {
      opener_verified: cited.length > 0,
      opener_reference: cited[0]?.claim ?? null,
      opener_evidence: cited.map(({ ref, claim, source_url, source_title, confidence }) => ({ ref, claim, source_url, source_title, confidence })),
    };
  }
  await saveOutput(companyId, type, out.content, fb ? "ai_feedback" : "ai_regenerate", extra);
  refresh();
  return { ok: true, note: out.needs_research ? `Not in the evidence: ${out.needs_research}` : null };
}

export async function restoreVersion(companyId, versionId) {
  if (!UUID_RE.test(companyId) || !Number.isInteger(Number(versionId))) return { ok: false, error: "Invalid request" };
  const { data: v } = await db().from("report_versions").select("*").eq("id", Number(versionId)).eq("company_id", companyId).maybeSingle();
  if (!v) return { ok: false, error: "Version not found" };
  const intel = v.output_type === "first_line" ? { intel: await reverifyLine(companyId, v.content) } : {};
  await saveOutput(companyId, v.output_type, v.content, "restored", intel);
  refresh();
  return { ok: true };
}
