"use client";

// App-wide micro-interactions:
// 1) a ripple from the exact point you click on buttons, tabs, sidebar items, rows and cards
// 2) a thin gradient progress bar at the top while moving between pages
// Both are skipped for people who prefer reduced motion.

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const RIPPLE_TARGETS = ".btn, .btn-text, .tab, .side-link, .row, .recent-chip, .stack-chip, .suggest-item, .acc > summary, .mini-acc > summary";

export default function Motion() {
  const path = usePathname();
  const params = useSearchParams();
  const routeKey = `${path}?${params.toString()}`;
  const [progress, setProgress] = useState(null); // null = hidden, 0–100 = visible
  const timer = useRef(null);
  const lastRoute = useRef(routeKey);

  // Ripple on click
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onDown = (e) => {
      const el = e.target.closest?.(RIPPLE_TARGETS);
      if (!el || el.disabled) return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      const dot = document.createElement("span");
      dot.className = "ripple";
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - rect.left - size / 2}px`;
      dot.style.top = `${e.clientY - rect.top - size / 2}px`;
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      el.classList.add("has-ripple");
      el.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove(), { once: true });
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  // Start the progress bar when an internal link is clicked
  useEffect(() => {
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // hash-only jump
      setProgress(12);
      clearInterval(timer.current);
      timer.current = setInterval(() => setProgress((p) => (p === null ? null : Math.min(90, p + (90 - p) * 0.12))), 180);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Finish it when the new page has rendered
  useEffect(() => {
    if (lastRoute.current === routeKey) return;
    lastRoute.current = routeKey;
    clearInterval(timer.current);
    const done = setTimeout(() => setProgress(100), 0);
    const hide = setTimeout(() => setProgress(null), 380);
    return () => { clearTimeout(done); clearTimeout(hide); };
  }, [routeKey]);

  useEffect(() => () => clearInterval(timer.current), []);

  return (
    <div className="nav-progress" aria-hidden style={{ opacity: progress === null ? 0 : 1 }}>
      <span style={{ transform: `scaleX(${(progress ?? 0) / 100})` }} />
    </div>
  );
}
