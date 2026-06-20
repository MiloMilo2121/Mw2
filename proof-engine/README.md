# Proof Engine

Per-company **proof artifacts** for Marco's SF target list. For a given company
domain, the engine ships a working, branded, bespoke artifact ("the thing I'd
build for you in week 1") + a delivery page with a shareable URL. Turns Marco
from *candidate* into *vendor who already delivered* — before the first call.

> **Only metric that counts:** real artifacts shipped and online — public URL,
> branded, running on the target's real public data.

## Runtime
Claude Code. Four stages, each a slash command + a dedicated subagent. State =
filesystem. No backend, no DB, no framework.

## Pipeline

```
/research <domain>  → targets/<slug>/dossier.json
/diagnose <slug>    → targets/<slug>/diagnosis.md      ← CHECKPOINT: approve wedge
/build <slug>       → targets/<slug>/artifact/ (live on Vercel)  ← CHECKPOINT: ok-to-deploy
/deliver <slug>     → one-pager + outreach.md + final URL
/proof <domain>     → full pipeline, stops at the 3 human checkpoints
```

## Human checkpoints (judgment stays with Marco)
1. **Target selection** — which companies, in what order.
2. **Wedge approval** — the one problem to hit (end of `/diagnose`).
3. **Ok-to-deploy** — no shareable URL without human review (end of `/build`).

## Layout

```
proof-engine/
├── CLAUDE.md                   # project memory + rules
├── .claude/agents/             # researcher, diagnostician, builder, copywriter
├── .claude/commands/           # research, diagnose, build, deliver, proof
├── lib/schema/dossier.schema.json
├── lib/design/                 # bridge to marco-milanello-design tokens
├── targets/<slug>/             # dossier, diagnosis, artifact, delivery
└── _pilot/                     # first end-to-end target, used as reference
```

## Rules (hard)
- SHIP > PERFECT. Pilot one target end-to-end before touching target 2.
- Every claim has a source URL. Missing data → `data_gaps`. Never hallucinate.
- One artifact = one real, specific problem of THAT company. Generic = trash.
- Deliverables in US English; instructions/chat in Italian.

## Design system
Load the `marco-milanello-design` skill **before** generating any UI.
Space Grotesk (display) + Inter (text); cream / terracotta / ink.
Local fallback tokens: `lib/design/tokens.json`.
