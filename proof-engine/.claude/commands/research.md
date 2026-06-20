---
description: Stage 1 — research a company domain into a schema-conformant dossier.json
argument-hint: <domain> [attio-handle]
---

Run Stage 1 (research) for the target whose domain is: **$ARGUMENTS**

Delegate to the `researcher` subagent. It must:
1. Pull existing CRM context from Attio if a record exists.
2. Produce `targets/<slug>/dossier.json` conforming exactly to
   `proof-engine/lib/schema/dossier.schema.json` (slug = lowercase hyphenated
   from the domain).
3. Meet the Stage 1 quality bar: ≥3 sourced `pain_signals`, populated
   `open_roles_relevant` if any exist, ≥3 company-specific `wedge_candidates`,
   honest `data_gaps`. Every claim has a source URL. Never invent numbers.

Output is US English. When done, show the 5-line summary.
