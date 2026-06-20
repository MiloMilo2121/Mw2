---
description: Full pipeline (research → diagnose → build → deliver) with stops at the 3 human checkpoints
argument-hint: <domain>
---

Run the **full Proof Engine pipeline** for: **$ARGUMENTS**

Execute the four stages in sequence, but **STOP and ask Marco at every
checkpoint — never skip them**:

1. **Checkpoint #1 — target selection.** Before researching, confirm with Marco
   that this is the right target / right order (if `/proof` was invoked with an
   explicit domain Marco chose, this is already satisfied — proceed).
2. `/research <domain>` → `dossier.json`.
3. `/diagnose <slug>` → `diagnosis.md`.
   **STOP — Checkpoint #2:** present dossier + diagnosis, wait for wedge approval.
4. `/build <slug>` → artifact live on Vercel.
   **STOP — Checkpoint #3:** present preview URL, wait for ok-to-ship.
5. `/deliver <slug>` → one-pager + outreach + final shareable URL.

Between checkpoints: full autonomy, reasonable defaults, don't flood Marco with
questions. Deliverables in US English. Remember the single metric: artifacts
online, not engine completed.
