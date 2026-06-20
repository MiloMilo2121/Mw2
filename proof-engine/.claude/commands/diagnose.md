---
description: Stage 2 — diagnose the dossier into ONE wedge + ONE artifact_type
argument-hint: <slug>
---

Run Stage 2 (diagnosis) for the target slug: **$ARGUMENTS**

Read `targets/$ARGUMENTS/dossier.json` and delegate to the `diagnostician`
subagent. It must:
1. Pick **ONE** wedge and **ONE** `artifact_type` (menu #1-5), scored by
   `acuteness × demonstrability × fit-with-Marco`. Challenge the dossier if the
   obvious problem is weak.
2. Write `targets/$ARGUMENTS/diagnosis.md` using the diagnosis template.

Output is US English.

**Then STOP at Checkpoint #2:** present the diagnosis to Marco and wait for
explicit wedge approval. Do NOT proceed to build.
