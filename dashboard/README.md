# Instantly Live Dashboard

A real-time, white-label, **client-facing** analytics dashboard built on top of
the [Instantly.ai](https://instantly.ai) V2 API. It replaces weekly PDF reports
with a live web app each client can open from a private link — read their
outbound performance, deliverability, and leave feedback in place.

> Built with Next.js (App Router) · Supabase · deploy on Vercel.

## Why

Instantly's native dashboard is fine but shallow. This app adds:

- **Live KPIs** with period-over-period deltas (open/reply/bounce/opportunities/pipeline)
- **Trend charts** and **per-campaign** breakdowns, sortable
- **Deliverability / account health** view with a derived 0–100 health score
- **Feedback & collaboration** — clients comment, flag, or ask questions on any view
- **Report tab** with one-click **PDF (print)** and **CSV export**
- A **history store** (Supabase) so you keep trends beyond Instantly's window

## Access model

No login. Each client gets a private link: `/c/<slug>`. The `slug` is the shared
secret. The Instantly API key lives **only server-side** and is never sent to the
browser.

## Runs with zero config

With no environment variables set, the app serves realistic **mock data** so you
can demo and review the design immediately. Open `/c/demo`.

## Setup

```bash
cd dashboard
npm install
cp .env.example .env.local   # fill in to go live (optional)
npm run dev                  # http://localhost:3000  →  /c/demo
```

### Going live with real data

1. Create the Supabase tables in `supabase/schema.sql`
   (SQL editor, or the Supabase MCP `apply_migration`).
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Add clients — either:
   - a row in the `clients` table (`slug`, `name`, `instantly_api_key`, `accent_color`), or
   - the `DASHBOARD_CLIENTS` env var: `acme|ACME Corp|inst_key,globex|Globex|inst_key2`
4. Deploy to Vercel. The daily cron (`vercel.json`) hits `/api/sync` to snapshot
   history; protect it with `CRON_SECRET`.

## Data flow

```
Browser (/c/<slug>)
   │  SWR polls every 30s
   ▼
/api/c/<slug>/snapshot ── getClient(slug) ──> Supabase clients (api key)
   │                                              └─ or DASHBOARD_CLIENTS / demo
   ▼
buildSnapshot() ── Instantly V2 API (live)   ── or mock data if no key
   │
   └─ /api/sync (cron) ──> metric_snapshots (history)

Feedback: /api/c/<slug>/feedback  ──> Supabase feedback (or in-memory)
```

## Project layout

| Path | What |
| --- | --- |
| `src/lib/instantly.ts` | Instantly V2 REST client (read endpoints) |
| `src/lib/metrics.ts` | Snapshot assembly + aggregation (live or mock) |
| `src/lib/mock.ts` | Deterministic demo data generator |
| `src/lib/clients.ts` | Slug → client/API-key resolution |
| `src/lib/feedback.ts` | Feedback persistence (Supabase / memory) |
| `src/app/api/...` | Route handlers: snapshot, feedback, export, sync |
| `src/components/dashboard/*` | The dashboard UI (tabs, charts, feedback) |
| `supabase/schema.sql` | Database schema |

## Notes

- All charts are hand-rolled SVG — no chart library dependency.
- Live Instantly calls require approval when proxied through MCP; in production
  the app calls the REST API directly with the configured key.
