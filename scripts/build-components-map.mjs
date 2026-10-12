// Builds docs/components-map.html — a swimlane Components Map (actors × stages) that follows one
// company from request to Nikhil's screen. Render to PNG/PDF with headless Chrome (see README).
// Run: node scripts/build-components-map.mjs

import { writeFileSync } from "node:fs";

const W = 1600;
const LEFT = 30;            // page margin
const ACTOR_W = 180;        // actor column
const TOP = 80;             // header band top
const HEADER_H = 52;
const LANE_TOP = 141;
const LANE_H = 118;
const COLS = ["Trigger", "Input", "Context", "Processing", "AI", "Output"];
const COL_W = (W - LEFT * 2 - ACTOR_W) / COLS.length; // ≈ 226.7
const BOX_W = 200;
const BOX_H = 92;

// Lanes: actor name, technology, lane tint, box fill, box border
const LANES = [
  { name: "Code & Schedule", tech: "GitHub, Vercel Cron", tint: "#e7eefb", fill: "#dce7fb", border: "#4a7fd0" },
  { name: "Nikhil", tech: "Account executive", tint: "#e7eefb", fill: "#ffffff", border: "#d14b4b" },
  { name: "Public Sources", tech: "GitHub, job boards, Google", tint: "#e6f1fa", fill: "#d9eaf8", border: "#3f8fcf" },
  { name: "Database", tech: "Supabase Postgres", tint: "#e6f3e8", fill: "#d7f0dc", border: "#2f9a4c" },
  { name: "Evidence & Scoring", tech: "Rules in code", tint: "#e8f5f2", fill: "#d4efe8", border: "#1f9a85" },
  { name: "AI Writer", tech: "Gemini Flash", tint: "#efe8f8", fill: "#e6dcfa", border: "#7c5ccf" },
  { name: "System", tech: "App on Vercel", tint: "#fdf6e3", fill: "#fbecc0", border: "#d4a017" },
  { name: "Dashboard", tech: "Next.js on Vercel", tint: "#fcecf0", fill: "#ffffff", border: "#d14b4b" },
  { name: "People", tech: "Nikhil, the sales call", tint: "#fbf0e8", fill: "#ffffff", border: "#d14b4b" },
];

// Boxes: [lane, column, text]
const BOXES = {
  cron: [0, 0, "Code on GitHub deploys to Vercel. Cron runs daily 3 AM UTC and re-researches any company older than 6 days (weekly)."],
  ask: [1, 0, "Types a company in New research (auto-suggest fills the website) or clicks Refresh now on a report."],
  sources: [2, 1, "Live public data: GitHub repos and languages, official job posts, engineering blogs and talks, the company website."],
  db: [3, 2, "Watchlist and FlowForge's target profile. Last good evidence is kept if a source fails this week."],
  rules: [4, 3, "Each finding gets a source link, date, tier and confidence. Gaps are listed. Fit score 0–100 is set in code."],
  ai: [5, 4, "Writes a 2-paragraph summary and one opening line using only cited evidence. Never sets the score."],
  check: [6, 3, "Checks the AI text: the line must cite strong evidence; unknown tools are rejected. Saves report and run log."],
  dash: [7, 5, "Watchlist ranked by fit. Report: opening line with its source, summary, evidence, score, history."],
  people: [8, 5, "Nikhil copies the line, edits or rewrites it, logs outreach. Nothing is ever sent to the prospect."],
};

// One company's path, in order
const FLOW = [
  ["cron", "sources"],
  ["ask", "sources"],
  ["sources", "db"],
  ["db", "rules"],
  ["rules", "ai"],
  ["ai", "check"],
  ["check", "dash"],
  ["dash", "people"],
];

const colX = (c) => LEFT + ACTOR_W + c * COL_W;
const laneY = (l) => LANE_TOP + l * LANE_H;
const box = (key) => {
  const [l, c] = BOXES[key];
  const x = colX(c) + (COL_W - BOX_W) / 2;
  const y = laneY(l) + (LANE_H - BOX_H) / 2;
  return { x, y, w: BOX_W, h: BOX_H, cx: x + BOX_W / 2, cy: y + BOX_H / 2, right: x + BOX_W, bottom: y + BOX_H };
};

function wrap(text, max = 29) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > max) { lines.push(line.trim()); line = word; }
    else line += " " + word;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Arrow routing in the style of the sample: out of the right side, down the gutter, into the left side;
// straight down when in the same column; down-and-back when the next box is to the left.
function route(a, b) {
  const A = box(a), B = box(b);
  if (Math.abs(A.cx - B.cx) < 1) return `M${A.cx} ${A.bottom} V${B.y}`;
  if (B.cx > A.cx) {
    const gx = A.right + 10;
    return `M${A.right} ${A.cy} H${gx} V${B.cy} H${B.x}`;
  }
  const midY = A.bottom + (B.y - A.bottom) / 2;
  return `M${A.cx} ${A.bottom} V${midY} H${B.cx} V${B.y}`;
}

const H = LANE_TOP + LANES.length * LANE_H + 70;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, Segoe UI, Arial, sans-serif">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#1b2a4a"/></marker></defs>
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="${W / 2}" y="52" text-anchor="middle" font-size="31" font-weight="700" fill="#1b2a4a">Tech Stack Scout · Engineering Research for Sales — Components Map</text>
<rect x="${LEFT}" y="${TOP}" width="${W - LEFT * 2}" height="${HEADER_H}" rx="10" fill="#1b2a4a"/>
<text x="${LEFT + ACTOR_W / 2}" y="${TOP + 33}" text-anchor="middle" font-size="19" fill="#ffffff">Actor</text>`;
COLS.forEach((c, i) => {
  svg += `<text x="${colX(i) + COL_W / 2}" y="${TOP + 33}" text-anchor="middle" font-size="19" fill="#ffffff">${c}</text>`;
});

// Lanes
LANES.forEach((lane, l) => {
  const y = laneY(l);
  svg += `<rect x="${LEFT}" y="${y}" width="${ACTOR_W}" height="${LANE_H - 2}" fill="#1b2a4a"/>
<text x="${LEFT + ACTOR_W / 2}" y="${y + LANE_H / 2 - 4}" text-anchor="middle" font-size="19" font-weight="700" fill="#ffffff">${esc(lane.name)}</text>
<text x="${LEFT + ACTOR_W / 2}" y="${y + LANE_H / 2 + 19}" text-anchor="middle" font-size="12.5" fill="#c9d3e6">(${esc(lane.tech)})</text>
<rect x="${LEFT + ACTOR_W}" y="${y}" width="${W - LEFT * 2 - ACTOR_W}" height="${LANE_H - 2}" fill="${lane.tint}"/>`;
  for (let i = 1; i < COLS.length; i++) svg += `<line x1="${colX(i)}" y1="${y}" x2="${colX(i)}" y2="${y + LANE_H - 2}" stroke="#ffffff" stroke-width="2"/>`;
});

// Arrows under boxes
for (const [a, b] of FLOW) svg += `<path d="${route(a, b)}" fill="none" stroke="#1b2a4a" stroke-width="2" stroke-dasharray="6 5" marker-end="url(#arr)"/>`;

// Boxes
for (const key of Object.keys(BOXES)) {
  const [l, , text] = BOXES[key];
  const lane = LANES[l];
  const b = box(key);
  const lines = wrap(text);
  const lh = 15.5;
  const startY = b.cy - ((lines.length - 1) * lh) / 2 + 4.5;
  svg += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="9" fill="${lane.fill}" stroke="${lane.border}" stroke-width="2.2"/>`;
  lines.forEach((ln, k) => {
    svg += `<text x="${b.cx}" y="${startY + k * lh}" text-anchor="middle" font-size="12.6" fill="#1b2a4a">${esc(ln)}</text>`;
  });
}

// Footer
svg += `<text x="${LEFT}" y="${H - 34}" font-size="14" fill="#4a5568">Dashed arrows follow one company from request to Nikhil's screen. Red boxes are what Nikhil does or sees.</text>
<text x="${LEFT}" y="${H - 13}" font-size="14" fill="#4a5568">Facts come only from public sources, scores are computed in code, and Gemini Flash only writes text. If there's no engineering evidence, there's no score and the report explains why.</text>
</svg>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tech Stack Scout — Components Map</title>
<style>@page { size: ${W}px ${H}px; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; } svg { display: block; }</style>
</head><body>${svg}</body></html>`;
writeFileSync(new URL("../docs/components-map.html", import.meta.url), html);
console.log(`docs/components-map.html written (${W}×${H})`);
