// Read-only JSON of the watchlist + latest research (for integrations, e.g. a CRM sync).

import { getWatchlist } from "@/lib/data";

export async function GET() {
  try {
    const companies = await getWatchlist();
    return Response.json({ companies });
  } catch (err) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
