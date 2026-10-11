"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/supabaseAdmin";
import { getProductProfile, refreshCompany } from "@/lib/refresh";

const STATUSES = ["not_contacted", "contacted", "replied", "meeting", "won", "lost"];
const MIN_GAP_MS = 10 * 60 * 1000; // stop the public "Refresh now" button from burning API quota

export async function refreshNow(companyId) {
  const { data: company } = await db()
    .from("companies")
    .select("*, company_intel(last_attempted)")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return { ok: false, error: "Company not found" };

  const intel = Array.isArray(company.company_intel) ? company.company_intel[0] : company.company_intel;
  const last = intel?.last_attempted ? new Date(intel.last_attempted).getTime() : 0;
  if (Date.now() - last < MIN_GAP_MS) {
    const wait = Math.ceil((MIN_GAP_MS - (Date.now() - last)) / 60000);
    return { ok: false, error: `Refreshed moments ago — try again in ${wait} min.` };
  }

  const product = await getProductProfile();
  const result = await refreshCompany(company, product);
  refresh();
  return result;
}

export async function setOutreachStatus(companyId, status) {
  if (!STATUSES.includes(status)) return { ok: false, error: "Invalid status" };
  const { error } = await db().from("companies").update({ outreach_status: status }).eq("id", companyId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
