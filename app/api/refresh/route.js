// Called daily by Vercel Cron (see vercel.json). Refreshes every company whose research is
// more than 6 days old, so each account is refreshed weekly.
// Manual run:  curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/refresh?force=1"

import { refreshStale } from "@/lib/refresh";

export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  try {
    const summary = await refreshStale({
      force: url.searchParams.get("force") === "1",
      companyId: url.searchParams.get("company"),
    });
    return Response.json({ ok: true, ranAt: new Date().toISOString(), ...summary });
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
