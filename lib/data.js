// Read queries for the dashboard (server-side only).

import "server-only";
import { connection } from "next/server";
import { db } from "./supabaseAdmin.js";
import { sizeCheck } from "./size.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
// Baseline from the brief: 2–3 hours per 20-company sprint ≈ 7.5 min per company.
export const MANUAL_MIN_PER_COMPANY = 7.5;
export const REVIEW_MIN_PER_COMPANY = 1;

const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null);
const UUID_RE = /^[0-9a-f-]{36}$/i;

// Size thresholds live in product_profile (editable in Supabase); missing columns fall back to code defaults.
async function productProfile() {
  const { data } = await db().from("product_profile").select("*").eq("id", 1).maybeSingle();
  return data ?? {};
}
const withSize = (intel, product) => (intel ? { ...intel, size: sizeCheck(intel.web_mentions?.company_size, product) } : intel);

export async function getWatchlist() {
  await connection();
  const [{ data, error }, { data: ev }, product] = await Promise.all([
    db().from("companies").select("*, company_intel(*)").order("name"),
    db().from("evidence").select("company_id, confidence, source_url"),
    productProfile(),
  ]);
  if (error) throw new Error(error.message);

  const counts = {};
  for (const e of ev ?? []) {
    const c = (counts[e.company_id] ??= { total: 0, high: 0, medium: 0, low: 0, linked: 0 });
    c.total++;
    c[e.confidence]++;
    if (e.source_url) c.linked++;
  }
  const all = data.map((c) => ({ ...c, intel: withSize(one(c.company_intel), product), company_intel: undefined, evidence: counts[c.id] ?? null }));
  return {
    active: all.filter((c) => c.active).sort((a, b) => (b.intel?.fit_score ?? -1) - (a.intel?.fit_score ?? -1)),
    removed: all.filter((c) => !c.active),
  };
}

export async function getCompany(id) {
  await connection();
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await db().from("companies").select("*, company_intel(*)").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [{ data: history }, { data: evidence }, { data: versions }, product] = await Promise.all([
    db().from("intel_history").select("fit_score, captured_at").eq("company_id", id).order("captured_at", { ascending: true }).limit(12),
    db().from("evidence").select("*").eq("company_id", id).order("id"),
    db().from("report_versions").select("*").eq("company_id", id).order("created_at", { ascending: false }).limit(30),
    productProfile(),
  ]);
  return {
    ...data,
    intel: withSize(one(data.company_intel), product),
    company_intel: undefined,
    history: history ?? [],
    evidence: evidence ?? [],
    versions: versions ?? [],
  };
}

export async function getRecentRuns(limit = 5) {
  await connection();
  const { data } = await db().from("refresh_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  return data ?? [];
}

export function computeMetrics(companies) {
  const now = Date.now();
  const withIntel = companies.filter((c) => c.intel?.last_refreshed);
  const fresh = withIntel.filter((c) => now - new Date(c.intel.last_refreshed).getTime() <= WEEK);
  const verified = withIntel.filter((c) => c.intel.opener_verified);
  const evidenceTotal = companies.reduce((a, c) => a + (c.evidence?.total ?? 0), 0);
  const evidenceStrong = companies.reduce((a, c) => a + (c.evidence?.high ?? 0) + (c.evidence?.medium ?? 0), 0);
  const evidenceLinked = companies.reduce((a, c) => a + (c.evidence?.linked ?? 0), 0);

  const funnel = {};
  for (const tier of ["A", "B", "C"]) {
    const inTier = companies.filter((c) => c.intel?.fit_tier === tier);
    const contacted = inTier.filter((c) => c.outreach_status !== "not_contacted");
    const replied = contacted.filter((c) => ["replied", "meeting", "won"].includes(c.outreach_status));
    const meetings = contacted.filter((c) => ["meeting", "won"].includes(c.outreach_status));
    funnel[tier] = {
      total: inTier.length,
      contacted: contacted.length,
      replyRate: contacted.length ? replied.length / contacted.length : null,
      meetingRate: contacted.length ? meetings.length / contacted.length : null,
    };
  }

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const lastRefresh = withIntel.reduce((max, c) => (!max || c.intel.last_refreshed > max ? c.intel.last_refreshed : max), null);
  const nextRun = new Date();
  nextRun.setUTCHours(3, 0, 0, 0); // vercel.json cron: 0 3 * * *
  if (nextRun.getTime() <= now) nextRun.setUTCDate(nextRun.getUTCDate() + 1);

  return {
    lastRefresh,
    nextRun: nextRun.toISOString(),
    tiers: Object.fromEntries(["A", "B", "C"].map((t) => [t, companies.filter((c) => c.intel?.fit_tier === t).length])),
    total: companies.length,
    researched: withIntel.length,
    freshPct: pct(fresh.length, companies.length),
    verifiedPct: pct(verified.length, withIntel.length),
    evidenceTotal,
    strongPct: pct(evidenceStrong, evidenceTotal),
    linkedPct: pct(evidenceLinked, evidenceTotal),
    tierA: companies.filter((c) => c.intel?.fit_tier === "A").length,
    manualMinutes: Math.round(companies.length * MANUAL_MIN_PER_COMPANY),
    reviewMinutes: Math.round(companies.length * REVIEW_MIN_PER_COMPANY),
    errors: companies.filter((c) => c.research_status === "failed").length,
    inProgress: companies.filter((c) => ["queued", "researching"].includes(c.research_status)).length,
    funnel,
  };
}
