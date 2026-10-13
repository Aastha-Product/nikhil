-- Tech Stack Scout — run this whole file once in Supabase → SQL Editor → New query → Run.

-- ─────────────────────────────────────────────────────────────
-- 1. The watchlist. Nikhil edits this in the Table Editor.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  github_org       text not null,                    -- GitHub org/user handle, e.g. 'stripe'
  job_board        text,                             -- optional: 'greenhouse:stripe' | 'lever:netflix' | 'ashby:linear'
  website          text,                             -- optional
  notes            text,                             -- optional, Nikhil's own notes
  outreach_status  text not null default 'not_contacted'
                   check (outreach_status in ('not_contacted','contacted','replied','meeting','won','lost')),
  created_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 2. What we sell. One row. Edit it to change what "good fit" means.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.product_profile (
  id                    int primary key default 1 check (id = 1),
  name                  text not null default 'FlowForge',
  pitch                 text not null default 'FlowForge cuts CI build and test time for microservice teams with remote build caching, test-impact analysis and on-demand preview environments on Kubernetes.',
  strong_languages      text[] not null default '{Go,TypeScript,JavaScript,Python,Java,Kotlin,Rust}',
  neutral_languages     text[] not null default '{C#,Ruby,Scala}',
  target_clouds         text[] not null default '{aws,gcp}',
  target_runtime        text[] not null default '{kubernetes,docker,helm}',
  intent_role_keywords  text[] not null default '{platform engineer,platform infrastructure,developer experience,developer productivity,devex,developer tools,sre,site reliability,infrastructure,devops,build engineer,build infrastructure,release engineer,ci/cd}',
  -- Company size check (our assumption; never changes the fit score). See migrations/003.
  min_engineers         int  not null default 50,
  max_engineers         int  not null default 2000,
  min_employees         int  not null default 200,
  min_revenue_inr_cr    int  not null default 50,
  min_funding_stage     text not null default 'Series B'
);

insert into public.product_profile (id) values (1) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 3. Live research + AI output, one row per company (written by the refresh job).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.company_intel (
  company_id       uuid primary key references public.companies(id) on delete cascade,
  top_languages    jsonb,          -- [{name, pct}]
  infra_signals    jsonb,          -- [{key, label, sources:[...]}]
  activity_level   text,           -- 'High' | 'Medium' | 'Low' | 'None'
  activity_detail  jsonb,          -- {repos_pushed_30d, repos_pushed_90d, last_push, active_repos}
  notable_repos    jsonb,          -- [{name, description, language, stars, pushed_at, url}]
  hiring_signals   jsonb,          -- {board, total_eng_roles, intent_roles:[...], tools_mentioned:[...]}
  web_mentions     jsonb,          -- {findings:[...], sources:[{title,url}]}
  fit_score        int,            -- 0–100
  fit_tier         text,           -- 'A' | 'B' | 'C'
  confidence       text,           -- 'High' | 'Medium' | 'Low'
  score_breakdown  jsonb,          -- [{key, label, points, max, evidence:[...]}]
  summary          text,           -- Gemini: two paragraphs
  first_line       text,           -- Gemini: suggested opener
  opener_reference text,           -- the real signal the opener is built on
  opener_verified  boolean,        -- code-checked: opener mentions ≥1 real extracted signal
  talking_points   jsonb,          -- ["...", "...", "..."]
  changes          jsonb,          -- what changed since the previous refresh
  status           text not null default 'ok',   -- 'ok' | 'error'
  error_message    text,
  last_refreshed   timestamptz,    -- last SUCCESSFUL refresh
  last_attempted   timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- 4. Weekly snapshots → "what changed since last week".
-- ─────────────────────────────────────────────────────────────
create table if not exists public.intel_history (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references public.companies(id) on delete cascade,
  fit_score      int,
  top_languages  jsonb,
  infra_signals  jsonb,
  captured_at    timestamptz not null default now()
);
create index if not exists intel_history_company_idx on public.intel_history (company_id, captured_at desc);

-- ─────────────────────────────────────────────────────────────
-- 5. Security: RLS on, no public policies.
--    The app reads and writes only from the server with the secret/service_role key,
--    so nothing is exposed to the browser. The Table Editor still works for Nikhil.
-- ─────────────────────────────────────────────────────────────
alter table public.companies       enable row level security;
alter table public.product_profile enable row level security;
alter table public.company_intel   enable row level security;
alter table public.intel_history   enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 6. Starter watchlist (real companies with active public GitHub orgs).
--    Delete or add rows freely in the Table Editor.
-- ─────────────────────────────────────────────────────────────
insert into public.companies (name, github_org, job_board, website)
select * from (values
  ('Stripe',    'stripe',    'greenhouse:stripe', 'https://stripe.com'),
  ('Vercel',    'vercel',    'greenhouse:vercel', 'https://vercel.com'),
  ('Supabase',  'supabase',  'ashby:supabase',    'https://supabase.com'),
  ('HashiCorp', 'hashicorp', null,                'https://hashicorp.com'),
  ('Airbnb',    'airbnb',    'greenhouse:airbnb', 'https://airbnb.com')
) as v(name, github_org, job_board, website)
where not exists (select 1 from public.companies);
