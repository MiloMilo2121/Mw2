---
description: Stage 3 — build the working, branded artifact and deploy to Vercel
argument-hint: <slug>
---

Run Stage 3 (build) for the target slug: **$ARGUMENTS**

Precondition: the wedge in `targets/$ARGUMENTS/diagnosis.md` has been approved
by Marco (Checkpoint #2). If not approved, stop and ask.

Delegate to the `builder` subagent. It must:
1. Load the `marco-milanello-design` skill BEFORE writing any UI.
2. Build a **working** artifact (it runs — generates/answers/enriches/calculates)
   using real public data of THIS target, into `targets/$ARGUMENTS/artifact/`.
3. Deploy to Vercel and meet every item of the Definition of Done.
4. No hardcoded API keys.

All UI/copy in US English.

**Then STOP at Checkpoint #3:** give Marco the preview URL and request explicit
ok-to-ship before the URL becomes shareable. Do NOT proceed to deliver.
