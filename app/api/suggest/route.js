// GET /api/suggest?q=datad → [{ name, domain, source, existingId? }]
// Powers the company-name autocomplete on the New research form.

import { suggestCompanies } from "@/lib/suggest";

export async function GET(request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const items = await suggestCompanies(q);
    return Response.json({ items }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return Response.json({ items: [] });
  }
}
