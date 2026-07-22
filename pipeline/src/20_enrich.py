"""20_enrich — enrichment via provider CASCADE, written to the per-domain cache.

Free-first (root CLAUDE.md, feedback Marco): each domain is enriched by the
cheapest provider that yields enough text, escalating only on a miss:

    1. scrape_direct  (FREE — multi-page HTTP: home + /immobili + /chi-siamo)
    2. firecrawl      (JS render — only if free text < free_min; costs credits)
    3. apify          (last resort — only if still < apify_min; €0.02/dominio)

Domains run in a bounded thread pool (providers.scrape_direct.parallel). Only
the paid fallbacks are charged against the budget; the free provider is €0.

Resume: only SUCCESSFUL enrichments (text, no errors) are skipped, so a failed
or empty domain is retried next run. The classifier (30) reads ONLY this cache.

  python src/20_enrich.py [--dry-run] [--force] [--limit N]

Guardrail: aborts if INSTANTLY_API_KEY is present.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import config
from lib.budget import BudgetExceeded, BudgetGuard
from lib.cache import is_enriched, write_cache
from lib.parallel import run_pool
from lib.providers import apify, firecrawl, scrape_direct
from lib.runlog import append_stage, merge_errors


def _len(frag: dict) -> int:
    return len((frag or {}).get("text", "") or "")


def _enabled(cfg: dict, name: str, default: bool = True) -> bool:
    return bool(((cfg.get("providers", {}) or {}).get(name, {}) or {}).get("enabled", default))


def enrich_one(lead: dict, cfg: dict, tokens: dict, budget: BudgetGuard, thr: dict) -> dict:
    domain = lead["dominio"]
    frag = scrape_direct.enrich_domain(domain, cfg)  # free, primary
    provider = "scrape_direct"

    def try_paid(name: str, fn, cost: float, floor: int):
        nonlocal frag, provider
        if _len(frag) >= floor or not tokens.get(name) or budget.would_exceed(cost):
            return
        cand = fn()
        try:
            budget.charge(name, cost)  # a credit/compute was consumed by the call
        except BudgetExceeded:
            return
        if _len(cand) > _len(frag):
            frag, provider = cand, name

    if tokens.get("firecrawl") and _enabled(cfg, "firecrawl"):
        try_paid("firecrawl", lambda: firecrawl.enrich_domain(tokens["firecrawl"], domain, cfg),
                 firecrawl.cost_per_domain_eur(cfg), thr["free_min"])
    if tokens.get("apify") and _enabled(cfg, "apify"):
        try_paid("apify", lambda: apify.enrich_domain(tokens["apify"], domain, cfg),
                 apify.cost_per_domain_eur(cfg), thr["apify_min"])

    errs = frag.get("errors") or ([] if _len(frag) else ["no content"])
    write_cache(domain, {"domain": domain, "seed": lead.get("seed", {}), "annunci": frag.get("annunci", []),
                         "text": frag.get("text", ""), "sources": frag.get("sources", []),
                         "providers": frag.get("providers", [provider]), "errors": errs})
    return {"domain": domain, "ok": bool(_len(frag) and not frag.get("errors")),
            "provider": provider, "chars": _len(frag), "error": errs[0] if errs else ""}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    config.assert_no_instantly()
    cfg = config.load_config()
    p = config.DATA_OUT / "run_state.json"
    if not p.exists():
        print("No run_state.json — run 10_ingest first.")
        return 1
    state = json.loads(p.read_text(encoding="utf-8"))
    leads = state.get("leads", [])
    if args.limit:
        leads = leads[: args.limit]

    budget = BudgetGuard(config.budget_cap_eur())
    todo = [l for l in leads if args.force or not is_enriched(l["dominio"])]
    skipped = len(leads) - len(todo)

    if args.dry_run:
        append_stage("enrich", {"to_enrich": len(todo), "cached_skip": skipped,
                                "est_cost_eur": 0.0, "dry_run": True, "mode": "free-first cascade"})
        print(f"enrich (dry-run): {len(todo)} da arricchire, {skipped} in cache. "
              f"Free-first: costo stimato ~€0 (Firecrawl/Apify solo sui miss).")
        return 0

    sd = (cfg.get("providers", {}) or {}).get("scrape_direct", {}) or {}
    tokens = {"firecrawl": config.env("FIRECRAWL_API"), "apify": config.env("APIFY_API")}
    thr = {"free_min": int(sd.get("min_chars", 500)), "apify_min": int(sd.get("apify_min_chars", 300))}
    workers = int(sd.get("parallel", 16))

    results = run_pool(todo, lambda l: enrich_one(l, cfg, tokens, budget, thr), workers)

    from collections import Counter
    by_prov = Counter(r["provider"] for r in results if r["ok"])
    enriched = sum(1 for r in results if r["ok"])
    fails = [{"domain": r["domain"], "stage": "enrich", "error": r["error"]} for r in results if not r["ok"]]
    if fails:
        merge_errors("enrich", fails)
    append_stage("enrich", {"enriched": enriched, "cached_skip": skipped, "errors": len(fails),
                            "by_provider": dict(by_prov), "budget_spent_eur": round(budget.spent, 4),
                            "workers": workers, "dry_run": False})
    print(f"enrich: {enriched} arricchiti ({dict(by_prov)}), {skipped} in cache, {len(fails)} vuoti, "
          f"spesa €{budget.spent:.3f} ({workers} paralleli)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
