---
description: Stage 4 — write the branded one-pager + pre-warm outreach, ship final URL
argument-hint: <slug>
---

Run Stage 4 (delivery) for the target slug: **$ARGUMENTS**

Precondition: the artifact for `$ARGUMENTS` is live and Marco gave ok-to-ship
(Checkpoint #3).

Delegate to the `copywriter` subagent. It must:
1. Write the branded one-pager (load `marco-milanello-design` first) to
   `targets/$ARGUMENTS/delivery/one-pager/`, following the 6-part structure,
   hosting/linking the live artifact. Deploy it to Vercel for the final URL.
2. Write `targets/$ARGUMENTS/delivery/outreach.md` (LinkedIn short + Email
   medium): observation → "I built X, here's the link" → single CTA.
3. Update the **Stato** section of `proof-engine/CLAUDE.md` marking this target
   completed with its URLs.

US English, Marco's voice, zero hype. Print final one-pager URL + artifact URL +
decision-maker entry hook.
