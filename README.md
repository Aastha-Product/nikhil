# Tech Stack Scout

AI-powered tech-stack intelligence for **FlowForge**'s target accounts. It keeps Nikhil's Supabase
watchlist current with **live** engineering context, ranks every account with a **0–100 fit score**,
and has **Gemini Flash** write a two-paragraph briefing plus a specific first outreach line.

> MESA Cohort C4 · AI and its Applications · Section 1 Final · Problem Statement 4

## What Nikhil gets per company

| | Source (live) |
|---|---|
| Dominant languages (% of code) | GitHub REST API |
| Cloud / infra / CI tooling, with evidence | GitHub + job posts + Google Search |
| Build activity (repos pushed in 30 / 90 days) | GitHub |
| Open platform / DevEx / SRE roles | Greenhouse · Lever · Ashby public job-board APIs |
| Recent engineering blog posts & talks, with links | Gemini + Google Search grounding |
| **Fit score, tier (A/B/C), confidence, and why** | Computed in code (`lib/score.js`) |
| **2-paragraph summary, first line, 3 talking points** | Gemini Flash (`lib/gemini.js`) |
| What changed since last week | `intel_history` snapshots |

The opener is **checked in code**: it must mention at least one real extracted signal (a repo,
language, tool, role or talk). Otherwise Gemini is asked to rewrite it.

## Components Map

```
                    ┌──────────────────────── VERCEL ────────────────────────┐
                    │                                                        │
 Nikhil ──browser──►│  Next.js UI  (/ watchlist, /company/[id] detail)       │
                    │     │ server components + server actions               │
                    │     ▼                                                  │
                    │  lib/data.js ─────────────────────────────┐            │
                    │                                           │            │
 Vercel Cron ──────►│  /api/refresh  (daily, CRON_SECRET)       │            │
  0 3 * * *         │     │ lib/refresh.js: stalest first,      │            │
                    │     │ only rows older than 6 days         │            │
                    │     ├──► lib/github.js ──► GitHub REST API │            │
                    │     ├──► lib/jobs.js ────► Greenhouse / Lever / Ashby  │
                    │     ├──► lib/gemini.js ──► Gemini Flash (+ Google Search)
                    │     ├──► lib/score.js  (fit score, pure code)          │
                    │     ▼                                     ▼            │
                    └─────┼─────────────────────────────────────┼────────────┘
                          ▼                                     ▼
              ┌───────────────────── SUPABASE (Postgres) ─────────────────────┐
              │ companies (watchlist — edited in Table Editor, no code)        │
              │ product_profile (what FlowForge targets — drives the score)    │
              │ company_intel (latest research)   intel_history (weekly diff)  │
              └────────────────────────────────────────────────────────────────┘
```

| # | Component | Tech | Responsibility |
|---|---|---|---|
| 1 | Dashboard UI | Next.js 16 App Router | Ranked watchlist, metrics, tier funnel, company briefing, copy opener, outreach status, "Refresh now" |
| 2 | Refresh API | Route handler `/api/refresh` | Orchestrates the pipeline; protected by `CRON_SECRET`; time-budgeted |
| 3 | Scheduler | Vercel Cron (`vercel.json`) | Runs daily; any company older than 6 days is refreshed, so every account is refreshed weekly |
| 4 | Engineering signals | GitHub REST API | Languages, infra hints, service repos, CI workflows, activity |
| 5 | Hiring signals | Greenhouse / Lever / Ashby APIs | Engineering roles, platform/DevEx roles, tools in job descriptions |
| 6 | Web research | Gemini + Google Search grounding | Recent blog posts / talks, with source links |
| 7 | Fit scoring | `lib/score.js` (pure, unit-tested) | 0–100 score, tier, confidence, evidence per criterion |
| 8 | AI writer | Gemini Flash via `@google/genai` | Structured JSON: summary, first line, reference, talking points |
| 9 | Database | Supabase Postgres | Watchlist, product profile, intel, history; RLS on, server-only access |
| 10 | Hosting | Vercel | UI, functions, cron, public URL |

**No Claude API is used anywhere.** All AI calls go through `lib/gemini.js`.

## Fit score rubric (0–100)

| Criterion | Max | Signal |
|---|---|---|
| Language fit | 25 | Share of code in FlowForge's target languages |
| Cloud & infra fit | 25 | Kubernetes/Docker/Helm, AWS/GCP, Terraform/Pulumi |
| Microservices signal | 15 | Service-style repos, gRPC, Bazel/Nx/Turborepo, Kafka |
| Build velocity | 15 | Repos pushed in the last 90 days |
| CI pain signal | 10 | CI workflow density; "build times / developer productivity" in job posts |
| Buying intent | 10 | Open platform / DevEx / SRE / infra roles |

**A ≥ 75** call this week · **B 50–74** nurture · **C < 50** deprioritize. Confidence reflects how many
sources returned data. Edit `product_profile` in Supabase to change what counts as a fit, with no code.

---

## Setup (about 20 minutes)

### 1. Create the four accounts and keys

| Service | What to do | Env var |
|---|---|---|
| **Supabase** (supabase.com, free) | New project → **SQL Editor** → paste and run `supabase/schema.sql` → **Project Settings → API Keys**: copy the Project URL and the **secret** key (`sb_secret_…`, or the legacy `service_role` key) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Google AI Studio** (aistudio.google.com) | **Get API key** → create key. Check **Rate limits** to see which Flash models your key can call | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| **GitHub** | Settings → Developer settings → **Fine-grained tokens** → generate (public repositories, read-only, no extra permissions) | `GITHUB_TOKEN` |
| **Vercel** (vercel.com) | Sign up with GitHub | — |

Generate a `CRON_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Run locally

```bash
cp .env.example .env.local      # then fill in every value
npm install
npm run dev                     # http://localhost:3000
```

### 3. First refresh

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" "http://localhost:3000/api/refresh?force=1"
```

It takes about 20–40 seconds per company (two at a time). Or open any company and click **Refresh now**.

### 4. Deploy to Vercel

1. Push this folder to a GitHub repo (`.env.local` is git-ignored).
2. Vercel → **Add New → Project** → import the repo (framework: Next.js).
3. Add all six env vars from `.env.example` → **Deploy**.
4. Check **Settings → Cron Jobs** shows `/api/refresh`. Run it once with the curl above against your
   `*.vercel.app` URL.

## How Nikhil manages the watchlist (no code)

Supabase → **Table Editor → `companies`** (the dashboard has a direct link):

- **Add:** Insert row → `name` (e.g. *Datadog*) and `github_org` (the handle in `github.com/<handle>`).
  `job_board` is optional (`greenhouse:datadog`, `lever:<name>`, `ashby:<name>`); if blank, the app
  tries to find it automatically.
- **Remove:** select the row → Delete. Its research is deleted with it.
- **Track outreach:** set `outreach_status` here or with the dropdown on the company page.

The next daily run researches new companies automatically.

## Metrics on the dashboard

| Metric | Why it matters |
|---|---|
| Prep time per sprint | Brief's baseline: 2–3 h per 20 companies (≈7.5 min each), compared with ≈1 min to review a briefing |
| Research ≤ 7 days old | Stale research never follows Nikhil into a call |
| Openers citing a real signal | Specific openers are what drive the 30% higher close rate |
| Reply / meeting rate by tier | Checks the rubric: Tier A should outperform Tier C |

## Tests

```bash
npm test                                   # fit-score unit tests
node scripts/smoke.mjs stripe Stripe       # live GitHub + job-board pull, no keys needed
```

## Limits & future work

- GitHub only shows **public** code. Companies with little open source get *Low confidence*, not a low
  score. Job posts and web research fill the gap.
- First 100 repos per org (sorted by most recent push); languages from the 12 most active.
- Future: CRM write-back (HubSpot/Salesforce), Slack alert when a Tier-A account changes stack,
  auth for multiple reps.
