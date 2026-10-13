// Left navigation: every place Nikhil can go, with live counts. Data is loaded on the server;
// the active-item highlight is handled by SidebarNav (client).

import { connection } from "next/server";
import { computeMetrics, getWatchlist } from "@/lib/data";
import { isConfigured } from "@/lib/supabaseAdmin";
import SidebarNav from "./SidebarNav";

export default async function Sidebar() {
  await connection();
  if (!isConfigured()) return <SidebarNav counts={null} recent={[]} />;
  // If the database is down, keep the navigation working (without counts) instead of breaking every page.
  let active;
  try {
    ({ active } = await getWatchlist());
  } catch {
    return <SidebarNav counts={null} recent={[]} />;
  }
  const m = computeMetrics(active);
  const recent = [...active]
    .filter((c) => c.intel?.last_refreshed)
    .sort((a, b) => (b.intel.last_refreshed > a.intel.last_refreshed ? 1 : -1))
    .slice(0, 5)
    .map((c) => ({ id: c.id, name: c.name, github_org: c.github_org, tier: c.intel?.fit_tier ?? null }));
  return (
    <SidebarNav
      counts={{ total: m.total, A: m.tiers.A, B: m.tiers.B, C: m.tiers.C, busy: m.inProgress }}
      recent={recent}
    />
  );
}
