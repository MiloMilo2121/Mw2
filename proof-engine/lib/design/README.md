# Design bridge → `marco-milanello-design`

**Source of truth = the `marco-milanello-design` skill.** Load it before
generating ANY artifact or one-pager UI. `tokens.json` here is only a local
fallback so a build never stalls if the skill isn't loaded yet — refresh it
from the skill when available.

## Canonical (per build spec §3)
- Display font: **Space Grotesk**
- Body font: **Inter**
- Palette: **cream / terracotta / ink**

> ⚠️ Environment note (2026-06-20): the `marco-milanello-design` skill is **not
> installed** in this Claude Code environment, and the existing repo site
> (`/site`) ships a *different* dark/Geist/cyan system. Before building the
> first artifact UI, confirm with Marco which is canonical and get the skill
> loaded. The tokens below follow the build spec (cream/terracotta/ink), not
> the legacy site.

## Usage rule
1. Try to load `marco-milanello-design`. If present, its tokens win — ignore
   this file.
2. If absent, use `tokens.json` and flag the gap to Marco.
