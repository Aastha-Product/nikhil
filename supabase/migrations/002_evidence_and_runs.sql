-- Migration 002 — evidence records, research status, refresh runs, report versions.
-- Implements §6 (evidence rubric), §10 (refresh rules), §12 (data model) of the architecture doc.
-- Safe to run more than once.

-- ── Watchlist: dashboard-managed, soft remove, research status ──
alter table public.companies alter column github_org drop not null;
alter table public.companies add column if not exists normalized_name text;
alter table public.companies add column if not exists active boolean not null default true;
alter table public.companies add column if not exists research_status text not null default 'queued';
alter table public.companies add column if not exists updated_at timestamptz not null default now();
alter table public.companies drop constraint if exists companies_research_status_check;
alter table public.companies add constraint companies_research_status_check
  check (research_status in ('queued','researching','ready','partial','failed'));
update public.companies set normalized_name = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')) where normalized_name is null;
update public.companies c set research_status = 'ready'
  where research_status = 'queued' and exists (select 1 from public.company_intel i where i.company_id = c.id and i.last_refreshed is not null);

-- ── Company profile additions ──
alter table public.company_intel add column if not exists research_gaps jsonb;        -- [{area, detail}]
alter table public.company_intel add column if not exists opener_evidence jsonb;      -- cited evidence [{claim, source_url, confidence}]
alter table public.company_intel add column if not exists unsupported_claims jsonb;   -- tools the AI named without evidence
alter table public.company_intel add column if not exists summary_origin text;        -- ai_refresh | ai_regenerate | ai_feedback | edited | restored
alter table public.company_intel add column if not exists first_line_origin text;
alter table public.company_intel add column if not exists model text;
alter table public.company_intel add column if not exists generated_at timestamptz;

-- ── Evidence: one row per supported signal, with its source ──
create table if not exists public.evidence (
  id               bigint generated always as identity primary key,
  company_id       uuid not null references public.companies(id) on delete cascade,
  category         text not null check (category in ('language','infrastructure','activity','context','sales_relevance')),
  signal_key       text,                     -- e.g. 'kubernetes', 'Go' — used to verify AI output
  claim            text not null,
  excerpt          text,                     -- short supporting excerpt or structured signal
  source_url       text,
  source_title     text,
  source_type      text not null check (source_type in ('repository','job_posting','engineering_blog','conference_talk','company_page','third_party','api')),
  source_tier      int check (source_tier between 1 and 3),
  source_date      timestamptz,              -- publication / update date, if available
  observed_at      timestamptz not null default now(),
  evidence_status  text not null check (evidence_status in ('directly_stated','technically_observed','inferred','conflicting','unavailable')),
  confidence       text not null check (confidence in ('high','medium','low')),
  freshness        text not null check (freshness in ('current','aging','stale','unknown')),
  caveat           text
);
create index if not exists evidence_company_idx on public.evidence (company_id, category);

-- ── Refresh runs: job monitoring ──
create table if not exists public.refresh_runs (
  id                   bigint generated always as identity primary key,
  trigger              text not null check (trigger in ('cron','manual','dashboard','added')),
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  status               text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  companies_attempted  int not null default 0,
  companies_succeeded  int not null default 0,
  companies_failed     int not null default 0,
  companies_deferred   int not null default 0,
  error_summary        jsonb
);

-- ── Report versions: edit / regenerate history (never touches evidence) ──
create table if not exists public.report_versions (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  output_type  text not null check (output_type in ('summary','first_line')),
  content      text not null,
  origin       text not null check (origin in ('ai_refresh','ai_regenerate','ai_feedback','edited','restored')),
  feedback     text,
  model        text,
  created_at   timestamptz not null default now()
);
create index if not exists report_versions_company_idx on public.report_versions (company_id, output_type, created_at desc);

alter table public.evidence        enable row level security;
alter table public.refresh_runs    enable row level security;
alter table public.report_versions enable row level security;

-- Make PostgREST pick up the new columns/tables immediately.
notify pgrst, 'reload schema';
