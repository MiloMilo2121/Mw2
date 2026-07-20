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

-- Alerts history (P0). Append-only audit of notifications the cron sends to a
-- human operator (deliverability / campaign-status / open-rate / automation
-- failures). Persistence is best-effort: the notification is delivered first,
-- the row is written after — a failed insert never blocks an alert.
create table if not exists public.alerts (
  id           uuid primary key default gen_random_uuid(),
  client_slug  text not null references public.clients(slug) on delete cascade,
  kind         text not null,             -- account_error | campaign_status | low_open_rate | automation_failure | test
  severity     text not null default 'warning' check (severity in ('info','warning','critical')),
  title        text not null,
  body         text not null,
  context      jsonb,                      -- structured evidence (email, campaign id, ratios…)
  channel      text,                       -- telegram | email | webhook | console | null
  recipient    text,                       -- who it was sent to (ALERT_RECIPIENT value / url)
  delivered    boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists alerts_client_idx on public.alerts (client_slug, created_at desc);

-- NOTE on security: this app talks to Supabase exclusively with the SERVICE ROLE
-- key from server-side route handlers. The anon key is never used and these
-- tables are not exposed to the browser, so Row Level Security can stay enabled
-- with no public policies (default deny). Keep RLS ON:
alter table public.clients          enable row level security;
alter table public.feedback         enable row level security;
alter table public.metric_snapshots enable row level security;
alter table public.alerts           enable row level security;

-- Seed an example client (mock data, no API key):
-- insert into public.clients (slug, name, accent_color)
-- values ('acme', 'Acme Outbound', '#6366f1')
-- on conflict (slug) do nothing;
