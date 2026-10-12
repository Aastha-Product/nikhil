# Final QA report

**Date:** 12 October 2026 · **Build:** `main` on Vercel (https://nikhil-xi-three.vercel.app)
**Scope:** the Medium evaluation criteria (scoping, reliable outputs, edge cases, demonstrating it works) and the graded build items.

## Result: ready to submit

| Check | Result |
|---|---|
| Automated live QA (`npm run qa`), run against production and Supabase | **84 / 84 passed** |
| Unit tests (`npm test`): evidence rules, fit score, re-verification | **15 / 15 passed** |
| Lint and production build | Clean |
| Live end-to-end research run (Vercel, production) | Passed in 81 s: 34 findings, verified opening line |
| Manual click-through on the live site | All passed (below) |

## 1. Scoping the problem correctly (7/7)

Each requirement from the brief, checked against live data:

| Brief requirement | Evidence in the live system |
|---|---|
| Supabase watchlist, add/remove without code | 10 active companies; dashboard add/remove/restore and the Supabase Table Editor both work |
| Weekly refresh, research never stale | Daily cron ran in production; every company researched ≤ 7 days ago |
| Languages, cloud/infra tooling, build activity | Present for every scored company |
| Gemini Flash for all AI | `gemini-flash-latest` recorded on every report; no other AI provider in the code |
| Two-paragraph summary + specific first line | Checked per company below |
| Live external data | GitHub, Greenhouse/Lever/Ashby, Google Search grounding, all fetched at refresh time |

## 2. Building reliable outputs (50/50)

For each of the 9 companies with enough evidence:
- the summary is exactly two paragraphs;
- there is exactly one opening line, under 45 words, with no greeting or "I noticed";
- the line is verified and cites medium/high-confidence evidence with a link;
- an independent re-check found no technology named without evidence (4–15 technologies per company, all backed);
- the fit score has its 6-criterion breakdown.

Across all 206+ findings:
- each has a source URL, an observed date, a source type and tier, a confidence, a freshness label and a caveat;
- third-party sources are never rated high, and stale evidence is never rated high.

When there is no strong evidence (Mesa School of Business), there is no score, no opening line and no padded summary. The report shows "Not enough evidence to score" and lists the research gaps.

## 3. Handling edge cases (18/18)

| Edge case | Result |
|---|---|
| Refresh endpoint called without the secret, or with a wrong one | Rejected (401) |
| Unknown, malformed or injection-style company URLs | Friendly "not found" page |
| Auto-suggest with empty, 1-character, `<script>`, 500-character, Unicode or SQL-style input | Handled safely, valid response every time |
| Adult sites in company suggestions | Filtered out |
| Typing a company already on the watchlist | Flagged; opens the existing report instead of a duplicate |
| Company with no public evidence | "Not enough evidence to score", gaps listed |
| Missing or failed sources | Recorded as research gaps (all 10 companies have explicit gaps, nothing guessed) |
| Stuck jobs / failed company without a report | None |
| Refresh runs | All recent runs succeeded or were partial; none failed silently |

## 4. Demonstrating that it works: manual tests on the live site

| Action | Result |
|---|---|
| New research: type "shopif", pick from suggestions | Website filled in automatically ("✓ Filled in for you") |
| New research: type "datad" (already tracked) | "On your watchlist · open" → opens Datadog's report |
| Add company (Datadog, website only) | Queued → Researching → Ready in about 70 s; GitHub found via the website |
| Opening line → Improve → Rewrite | New line from the same evidence, still verified, saved as a version |
| History → Restore | Original line back; citation re-checked and matching |
| Refresh now twice | Second click refused: "try again in 8 min" |
| Manage list → Remove / Restore | Company leaves and returns; sidebar count updates |
| Sidebar shortcuts (Refresh log, Manage list, …) | Open the matching dropdown |
| Phone width (375 px) | No sideways scrolling |

## Security (2/2)

- No API keys or secrets in any page or browser script (8 scripts scanned).
- The database rejects access without the server key.

## Known limitations (say these openly in the viva)

- **No login.** Anyone with the link can add or remove companies. Removals are restorable and the list is capped at 30.
- **Google Search coverage varies week to week.** Missing blogs and talks are shown as a gap, never guessed.
- **Public signals only.** Private code and internal roadmaps aren't visible.
- **Gemini free-tier quota limits how many companies can be researched per day.** A failure is shown clearly and keeps the last good report.
- **Company auto-suggest depends on Clearbit's free endpoint,** with Wikidata as a backup.
