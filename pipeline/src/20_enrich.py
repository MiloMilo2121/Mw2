"""20_enrich — per-domain enrichment via Apify, written to the cache.

Reads data/out/run_state.json (from 10_ingest). For each domain: if already
cached, skip (resume — never re-pay); else run the Apify actor and cache the
result. The classifier (30) reads ONLY from this cache.

  python src/20_enrich.py [--dry-run] [--force] [--limit N]

--dry-run estimates calls + cost without spending. --force re-enriches cached
domains. Guardrail: aborts if INSTANTLY_API_KEY is present.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import config
from lib.budget import BudgetGuard
from lib.cache import is_enriched, read_cache, write_cache
from lib.parallel import run_pool
from lib.providers import apify
from lib.runlog import append_stage, merge_errors


def load_state() -> dict:
    p = config.DATA_OUT / "run_state.json"
    if not p.exists():
        print("No run_state.json — run 10_ingest first.")
        raise SystemExit(1)
    return json.loads(p.read_text(encoding="utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    config.assert_no_instantly()
    cfg = config.load_config()
    state = load_state()
    leads = state.get("leads", [])
    if args.limit:
        leads = leads[: args.limit]

    per_domain = apify.cost_per_domain_eur(cfg)
    budget = BudgetGuard(config.budget_cap_eur())
    token = config.env("APIFY_API")

    # Resume on SUCCESSFUL enrichments only → failed/empty domains get retried.
    todo = [l for l in leads if args.force or not is_enriched(l["dominio"])]
    skipped = len(leads) - len(todo)

    if args.dry_run:
        est = len(todo) * per_domain
        append_stage("enrich", {"to_enrich": len(todo), "cached_skip": skipped,
                                 "est_cost_eur": round(est, 3), "dry_run": True})
        print(f"enrich (dry-run): {len(todo)} to enrich, {skipped} cached, "
              f"est {est:.2f} EUR (cap {budget.cap:.0f})")
        return 0

    if not token:
        print("APIFY_API missing — set it or use --dry-run.")
        return 1

    # Cap the batch to what the budget affords, up front (§6: no silent partial).
    affordable = budget.affordable(per_domain)
    truncated = max(0, len(todo) - affordable)
    if truncated:
        print(f"budget: cap {budget.cap:.2f} EUR → arrivo a {affordable}/{len(todo)} domini ({truncated} rimandati)")
        todo = todo[:affordable]

    def enrich_one(lead: dict) -> dict:
        domain = lead["dominio"]
        frag = apify.enrich_domain(token, domain, cfg)
        errs = frag.get("errors") or []
        ok = not errs
        if ok:
            budget.charge("apify", per_domain)  # thread-safe; only successful runs
        write_cache(domain, {
            "domain": domain,
            "seed": lead.get("seed", {}),
            "annunci": frag["annunci"],
            "text": frag["text"],
            "sources": frag["sources"],
            "providers": frag.get("providers", []),
            "errors": errs,
        })
        return {"status": "ok" if ok else "err", "domain": domain, "error": errs[0] if errs else ""}

    workers = int((cfg.get("concurrency", {}) or {}).get("enrich", 6))
    results = run_pool(todo, enrich_one, workers)
    enriched = sum(1 for r in results if r["status"] == "ok")
    errors = sum(1 for r in results if r["status"] == "err")
    fails = [{"domain": r["domain"], "stage": "enrich", "error": r["error"]} for r in results if r["status"] == "err"]
    if fails:
        merge_errors("enrich", fails)

    append_stage("enrich", {"enriched": enriched, "cached_skip": skipped, "errors": errors,
                            "budget_truncated": truncated, "workers": workers,
                            "budget_spent_eur": round(budget.spent, 4), "dry_run": False})
    print(f"enrich: {enriched} enriched, {skipped} cached, {errors} errors, "
          f"spent {budget.spent:.3f} EUR ({workers} paralleli)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
