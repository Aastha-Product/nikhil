// Read-only JSON of the active watchlist + latest research (for integrations, e.g. a CRM sync).

import { getWatchlist } from "@/lib/data";

export async function GET() {
  try {
    const { active } = await getWatchlist();
    return Response.json({ companies: active });
  } catch (err) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
