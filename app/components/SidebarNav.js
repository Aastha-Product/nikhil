"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const ICONS = {
  search: "M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2-1.4 1.4-4.2-4.2A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z",
  list: "M4 5h16v2H4V5Zm0 6h16v2H4v-2Zm0 6h10v2H4v-2Z",
  star: "m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3Z",
  clock: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm1 2v4.6l3.2 1.9-1 1.7L11 12.7V7h2Z",
  pause: "M8 5h3v14H8V5Zm5 0h3v14h-3V5Z",
  refresh: "M12 4a8 8 0 0 1 7.4 5H17v2h6V5h-2v2.4A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8Zm8 8a8 8 0 0 1-15.4 3H7v-2H1v6h2v-2.4A10 10 0 0 0 22 12h-2Z",
  chart: "M4 20V10h3v10H4Zm6 0V4h3v16h-3Zm6 0v-7h3v7h-3Z",
  info: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 7h2v6h-2v-6Zm0-4h2v2h-2V7Z",
  gear: "M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4L10.7 6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.3 2.7h4l.3-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4-2.1-1.6ZM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z",
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden className="side-icon">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}

export default function SidebarNav({ counts, recent }) {
  const path = usePathname();
  const params = useSearchParams();
  const tier = params.get("tier") ?? "";
  const open = params.get("open") ?? "";
  const onList = path === "/watchlist";

  const isActive = (key) => {
    if (key === "new") return path === "/";
    if (key === "all") return onList && !tier && !open;
    if (["A", "B", "C"].includes(key)) return onList && tier === key;
    return onList && open === key;
  };
  const item = (key, href, icon, label, count) => (
    <Link key={key} href={href} className={`side-link ${isActive(key) ? "active" : ""}`} aria-current={isActive(key) ? "page" : undefined}>
      <Icon name={icon} />
      <span className="side-label">{label}</span>
      {count != null && <span className="side-count">{count}</span>}
    </Link>
  );

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <Link href="/" className="brand">
        <span className="brand-mark" aria-hidden>
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3L18.8 8 12 11.7 5.2 8 12 4.3ZM5 9.7l6 3.3v6.7l-6-3.3V9.7Zm8 10V13l6-3.3v6.7l-6 3.3Z" fill="currentColor" /></svg>
        </span>
        <span>Tech Stack Scout<small>for FlowForge sales</small></span>
      </Link>

      <nav className="side-nav">
        <div className="side-section">
          {item("new", "/", "search", "New research")}
          {item("all", "/watchlist", "list", "Watchlist", counts?.total)}
        </div>

        <div className="side-section">
          <div className="side-heading">Watchlist views</div>
          {item("A", "/watchlist?tier=A", "star", "Worth calling", counts?.A)}
          {item("B", "/watchlist?tier=B", "clock", "Nurture", counts?.B)}
          {item("C", "/watchlist?tier=C", "pause", "Later", counts?.C)}
        </div>

        <div className="side-section">
          <div className="side-heading">Insights</div>
          {item("log", "/watchlist?open=log#log", "refresh", "Refresh log")}
          {item("outreach", "/watchlist?open=outreach#outreach", "chart", "Outreach results")}
          {item("scoring", "/watchlist?open=scoring#scoring", "info", "How scoring works")}
          {item("manage", "/watchlist?open=manage#manage", "gear", "Manage list")}
        </div>

        {recent.length > 0 && (
          <div className="side-section side-recent">
            <div className="side-heading">Recent</div>
            {recent.map((c) => (
              <Link key={c.id} href={`/company/${c.id}`} className={`side-link ${path === `/company/${c.id}` ? "active" : ""}`}>
                {c.github_org ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`https://github.com/${c.github_org}.png?size=40`} alt="" width={18} height={18} className="side-avatar" />
                ) : (
                  <span className="side-avatar initials" aria-hidden>{c.name[0]}</span>
                )}
                <span className="side-label">{c.name}</span>
                {c.tier && <span className={`side-tier tier-${c.tier}`}>{c.tier}</span>}
              </Link>
            ))}
          </div>
        )}
      </nav>

      <div className="side-foot">
        <span className="live-dot" aria-hidden /> Live data · refreshed weekly
        {counts?.busy > 0 && <div className="side-busy">{counts.busy} researching now…</div>}
      </div>
    </aside>
  );
}
