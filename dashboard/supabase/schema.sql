-- ─────────────────────────────────────────────────────────────────────────────
-- Instantly Live Dashboard — Supabase schema
-- Run this in the Supabase SQL editor (or via the MCP apply_migration tool).
-- ─────────────────────────────────────────────────────────────────────────────

-- Tenants. The `slug` is the shared-secret used in the public URL (/c/<slug>).
create table if not exists public.clients (
  slug              text primary key,
  name              text not null,
  instantly_api_key text,                 -- server-side only
  accent_color      text,
  created_at        timestamptz not null default now()
);

-- Client-submitted feedback (comments / flags / questions) on any dashboard view.
create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  client_slug  text not null references public.clients(slug) on delete cascade,
  target       text not null,             -- e.g. "campaign:<id>", "overview"
  target_label text,
  author       text default 'Client',
  kind         text not null default 'comment' check (kind in ('comment','flag','question')),
  body         text not null,
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists feedback_client_idx on public.feedback (client_slug, created_at desc);

-- Daily metric snapshots — gives us history/trends beyond Instantly's own window.
-- Upserted by the /api/sync cron. One row per client per day.
create table if not exists public.metric_snapshots (
  client_slug      text not null references public.clients(slug) on delete cascade,
  day              date not null,
  emails_sent      integer not null default 0,
  opens            integer not null default 0,
  replies          integer not null default 0,
  clicks           integer not null default 0,
  bounced          integer not null default 0,
  opportunities    integer not null default 0,
  opportunity_value numeric not null default 0,
  captured_at      timestamptz not null default now(),
  primary key (client_slug, day)
);

-- NOTE on security: this app talks to Supabase exclusively with the SERVICE ROLE
-- key from server-side route handlers. The anon key is never used and these
-- tables are not exposed to the browser, so Row Level Security can stay enabled
-- with no public policies (default deny). Keep RLS ON:
alter table public.clients          enable row level security;
alter table public.feedback         enable row level security;
alter table public.metric_snapshots enable row level security;

-- Seed an example client (mock data, no API key):
-- insert into public.clients (slug, name, accent_color)
-- values ('acme', 'Acme Outbound', '#6366f1')
-- on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline "cestini" module (pipeline/, Python, on-demand).
-- ADDITIVE migration — the three tables above are untouched.
-- The Python pipeline WRITES here with the SERVICE ROLE key; the dashboard will
-- READ (separate task). Same posture as above: RLS ON, no public policies
-- (default deny). Never exposed to the browser.
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per pipeline run (a batch over a wave CSV).
create table if not exists public.pipeline_runs (
  id                uuid primary key default gen_random_uuid(),
  client_slug       text not null references public.clients(slug) on delete cascade,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  n_input           integer not null default 0,
  n_output          integer not null default 0,
  costo_stimato_eur numeric not null default 0,
  provider_usati    text[] not null default '{}'
);
create index if not exists pipeline_runs_client_idx on public.pipeline_runs (client_slug, started_at desc);

-- One row per deduped lead (agency domain) within a run.
create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  client_slug  text not null references public.clients(slug) on delete cascade,
  run_id       uuid not null references public.pipeline_runs(id) on delete cascade,
  dominio      text not null,
  company      text,
  email        text,
  email_valid  boolean,
  city         text,
  provincia    text,
  created_at   timestamptz not null default now(),
  unique (run_id, dominio)                 -- dedup per dominio, per run
);
create index if not exists leads_run_idx on public.leads (run_id);
create index if not exists leads_client_idx on public.leads (client_slug);

-- Extracted flags. Every flag carries evidence + source (root CLAUDE.md §5):
-- no evidence → the flag is 'unknown', never guessed.
create table if not exists public.flags (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  tipo       text not null,               -- open_house | struttura | nome_usabile | fascia_prezzo | invenduto_ratio | zona | solo_affitti
  valore     text,
  confidence numeric,
  evidenza   text,
  source_url text,
  provider   text,                         -- apify | perplexity | scrape_direct | llm | csv_seed | code
  created_at timestamptz not null default now()
);
create index if not exists flags_lead_idx on public.flags (lead_id);
create index if not exists flags_tipo_idx on public.flags (tipo);

-- Cestino assignment + resolved sequence recipe per lead, per run.
create table if not exists public.cestini (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  run_id      uuid not null references public.pipeline_runs(id) on delete cascade,
  cestino     text not null,               -- A | B | C | D | E
  motivo      text,
  sequenza_id text,
  tono        text,
  con_nome    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (run_id, lead_id)
);
create index if not exists cestini_run_idx on public.cestini (run_id, cestino);

-- Measured classifier error per flag per run. A cestino whose flag error_rate
-- exceeds the threshold is approvato=false and MUST be excluded from export.
create table if not exists public.qa_results (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.pipeline_runs(id) on delete cascade,
  flag_tipo  text not null,
  campione_n integer not null default 0,
  errori_n   integer not null default 0,
  error_rate numeric not null default 0,
  approvato  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (run_id, flag_tipo)
);
create index if not exists qa_results_run_idx on public.qa_results (run_id);

alter table public.pipeline_runs enable row level security;
alter table public.leads         enable row level security;
alter table public.flags         enable row level security;
alter table public.cestini       enable row level security;
alter table public.qa_results    enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log (P1.2). EVERY Instantly write (cron automation, UI upload, agent)
-- appends a row here. Written server-side with the service role; internal only.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  client_slug  text not null,
  actor        text not null,                -- cron | ui | agent
  azione       text not null,                -- e.g. add_leads_to_campaign | blocklist | move_sassi_rosa
  target       text,                         -- campagna/lista/blocklist target (nome o id)
  campaign_id  text,
  count        integer not null default 0,   -- quante entità toccate
  motivo       text,                         -- perché (regola/cestino/verdetto review)
  meta         jsonb,                        -- dettaglio strutturato (lead, verdetti, errori)
  created_at   timestamptz not null default now()
);
create index if not exists audit_log_client_idx on public.audit_log (client_slug, created_at desc);

alter table public.audit_log enable row level security;
