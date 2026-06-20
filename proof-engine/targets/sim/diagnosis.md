# Diagnosis — Sim (sim.ai)

## Selected wedge (the ONE problem)
Sim has 28.8k GitHub stargazers and 70,000+ developers but no system to tell
which of them sit inside high-value enterprise accounts — exactly the gap their
brand-new "Founding GTM Engineer" is being hired to close, with zero GTM infra
in place today.

## Why this one
- **Acuteness:** They are hiring their *first-ever* GTM person to "architect, not
  optimize" GTM/RevOps from zero, and the JD literally names Clay, scraping, and
  web-indexing — i.e. enrichment + scoring of inbound signal. The problem is open,
  funded, and unstaffed right now.
  (https://www.ycombinator.com/companies/sim/jobs/TGDFhbo-founding-gtm-engineer,
  https://www.sim.ai/blog/series-a)
- **Demonstrability:** Sim's stargazers are PUBLIC (GitHub API). I can pull a real
  sample of *their* stargazers, enrich each (company, role, company stage/size),
  score against their ICP (fast-growing technical teams / enterprise platform
  teams), and surface the accounts worth a first call. No mock data — their actual
  repo watchers. Buildable in days.
- **Fit with Marco:** This is the intersection itself — GTM strategy (ICP scoring,
  pipeline prioritization) + AI (LLM enrichment/classification) + engineering
  (live data pipeline). It is, almost line-for-line, the job they posted.

## Artifact type
**#3 — Enrichment micro-pipeline.** Takes a real sample of Sim's target signal
(their GitHub stargazers), enriches and scores it, and outputs a ranked,
call-ready account list. Chosen over #1 (outbound) because the *targeting* gap is
upstream of and more acute than the messaging gap, and over #2/#5 because it runs
on hard public data unique to Sim and can't be faked or reused.

## What the artifact will prove
That Marco can stand up the first piece of Sim's GTM data engine — turn their
open-source distribution into a prioritized enterprise pipeline — before day one.
It demonstrates the founding-GTM-engineer skillset (signal → enrichment → ICP
scoring → actionable list) on Sim's own data, not a generic template.

## Week-1 plan (if engaged)
- **Day 1-2:** Ingest the full stargazer + recent-fork/issue graph; resolve
  GitHub identity → person → company (enrichment provider + LLM fallback). Define
  the Sim ICP scoring rubric with the founders.
- **Day 3-5:** Score and segment (enterprise-intent / design-partner / noise);
  wire the ranked output into whatever CRM they choose (Attio/HubSpot) and draft
  the first ICP-tuned outbound sequences for the top tier; ship a refreshable
  pipeline, not a one-off export.

## Landing risk
- **"We already have this."** Mitigate: the artifact runs on their *real*
  stargazers with named accounts visible in the first screen — it's a working
  result, not a proposal, so even if they have a stack it shows speed + judgment.
- **Stale/unverified PII (founder LinkedIn handles are best-guess).** Mitigate:
  verify before outreach; the artifact itself uses only public GitHub data and
  labels any low-confidence enrichment.
- **Role may already be filled.** Mitigate: confirm the listing is live before
  sending; the angle still lands as "here's how I'd run your GTM data layer."

## Decision-maker entry point
**Emir Karabeg (Co-Founder & CEO)** — the hiring decision-maker for the founding
GTM role. Hook: "I pulled your 28.8k stargazers, found the [N] enterprise accounts
already watching Sim, and ranked who your first GTM hire should call Monday — it's
live here." CTO **Waleed Latif** is the secondary technical validator (the
pipeline's engineering should impress him). If they have people at AI Engineer
World's Fair (Jun 29–Jul 2, Moscone West), convert to a 15-min in-person.
