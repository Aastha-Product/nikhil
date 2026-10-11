// Called daily by Vercel Cron (see vercel.json). Refreshes every active company whose research is
// more than 6 days old, so each account is refreshed weekly. Each run is logged in refresh_runs.
// Manual run:  curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/refresh?force=1"

import { refreshStale } from "@/lib/refresh";

export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const fromCron = /vercel-cron/i.test(request.headers.get("user-agent") ?? "");
  try {
    const summary = await refreshStale({
      force: url.searchParams.get("force") === "1",
      companyId: url.searchParams.get("company"),
      trigger: fromCron ? "cron" : "manual",
    });
    return Response.json({ ok: true, ranAt: new Date().toISOString(), ...summary });
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
