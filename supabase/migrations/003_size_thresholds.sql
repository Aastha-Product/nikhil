-- Company size check (lib/size.js). Our assumption about who FlowForge sells to; edit these values in the
-- Table Editor (product_profile, row 1) to change them without code. They never change the fit score.
alter table public.product_profile
  add column if not exists min_engineers      int  not null default 50,
  add column if not exists max_engineers      int  not null default 2000,
  add column if not exists min_employees      int  not null default 200,
  add column if not exists min_revenue_inr_cr int  not null default 50,
  add column if not exists min_funding_stage  text not null default 'Series B';
