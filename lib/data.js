// Read queries for the dashboard (server-side only).

import "server-only";
import { connection } from "next/server";
import { db } from "./supabaseAdmin.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
// Baseline from the brief: 2–3 hours per 20-company sprint ≈ 7.5 min per company.
export const MANUAL_MIN_PER_COMPANY = 7.5;
export const REVIEW_MIN_PER_COMPANY = 1;

const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null);

export async function getWatchlist() {
  await connection();
  const { data, error } = await db()
    .from("companies")
    .select("*, company_intel(*)")
    .order("name");
  if (error) throw new Error(error.message);
  return data
    .map((c) => ({ ...c, intel: one(c.company_intel), company_intel: undefined }))
    .sort((a, b) => (b.intel?.fit_score ?? -1) - (a.intel?.fit_score ?? -1));
}

export async function getCompany(id) {
  await connection();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db().from("companies").select("*, company_intel(*)").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: history } = await db()
    .from("intel_history")
    .select("fit_score, captured_at")
    .eq("company_id", id)
    .order("captured_at", { ascending: true })
    .limit(12);
  return { ...data, intel: one(data.company_intel), company_intel: undefined, history: history ?? [] };
}

export function computeMetrics(companies) {
  const now = Date.now();
  const withIntel = companies.filter((c) => c.intel?.last_refreshed);
  const fresh = withIntel.filter((c) => now - new Date(c.intel.last_refreshed).getTime() <= WEEK);
  const verified = withIntel.filter((c) => c.intel.opener_verified);
  const confident = withIntel.filter((c) => ["High", "Medium"].includes(c.intel.confidence));

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
    confidentPct: pct(confident.length, withIntel.length),
    tierA: companies.filter((c) => c.intel?.fit_tier === "A").length,
    manualMinutes: Math.round(companies.length * MANUAL_MIN_PER_COMPANY),
    reviewMinutes: Math.round(companies.length * REVIEW_MIN_PER_COMPANY),
    errors: companies.filter((c) => c.intel?.status === "error").length,
    funnel,
  };
}
