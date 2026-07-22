"""30_classify — extract flags. Reads ONLY the cache (never the network).

Deterministic flags (fascia_prezzo, invenduto_ratio, zona) are computed in CODE;
open_house / struttura / nome_usabile / solo_affitti come from the LLM, each with
evidence + source (§5). Writes rows to the `flags` table and a human-readable
data/out/flags_preview.json for the 20-domain manual check.

Hardened: LLM calls run in a bounded thread pool, results are cached per domain
(a re-run reuses them — no re-spend) unless --force, and the number of NEW paid
calls is capped by the budget up front.

  python src/30_classify.py [--dry-run] [--force] [--limit N]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import classify, config
from lib.budget import BudgetGuard
from lib.cache import read_cache, read_flags_cache, write_flags_cache
from lib.db import SupabaseWriter
from lib.flags_det import invenduto_ratio, median_price
from lib.parallel import run_pool
from lib.runlog import append_stage, merge_errors


def det_flags(lead_id: str, cache: dict, seed: dict) -> list[dict]:
    rows: list[dict] = []
    annunci = (cache or {}).get("annunci", [])
    mp = median_price(annunci)
    if mp is not None:
        rows.append({"lead_id": lead_id, "tipo": "fascia_prezzo", "valore": str(int(mp)),
                     "evidenza": f"mediana su {len(annunci)} annunci", "provider": "code"})
    iv = invenduto_ratio(annunci)
    if iv is not None:
        rows.append({"lead_id": lead_id, "tipo": "invenduto_ratio", "valore": f"{iv:.3f}",
                     "evidenza": f"{len(annunci)} annunci datati", "provider": "code"})
    zona = (seed or {}).get("zona") or ""
    if zona:
        rows.append({"lead_id": lead_id, "tipo": "zona", "valore": zona, "provider": "csv_seed"})
    return rows


def llm_flags(lead_id: str, parsed: dict) -> list[dict]:
    rows: list[dict] = []
    ia = parsed.get("is_agency") or {}
    if ia.get("value"):
        rows.append({"lead_id": lead_id, "tipo": "is_agency", "valore": str(ia.get("value")),
                     "evidenza": ia.get("evidence"), "provider": "llm"})
    for tipo in ("open_house", "struttura", "nome_usabile"):
        f = parsed.get(tipo) or {}
        rows.append({"lead_id": lead_id, "tipo": tipo, "valore": f.get("value"),
                     "confidence": f.get("confidence"), "evidenza": f.get("evidence"),
                     "source_url": f.get("source_url"), "provider": "llm"})
    sa = parsed.get("solo_affitti") or {}
    if sa:
        rows.append({"lead_id": lead_id, "tipo": "solo_affitti", "valore": str(sa.get("value")),
                     "evidenza": sa.get("evidence"), "provider": "llm"})
    # fascia from the LLM when the crawler gave only text (no structured listings).
    fp = parsed.get("fascia_prezzo") or {}
    med = fp.get("mediana_eur")
    if isinstance(med, (int, float)) and med > 0:
        rows.append({"lead_id": lead_id, "tipo": "fascia_prezzo", "valore": str(int(med)),
                     "evidenza": f"{fp.get('n_annunci_letti', '?')} annunci (LLM)", "provider": "llm",
                     "_from_llm": True})
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="riclassifica anche i domini già in cache")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    config.assert_no_instantly()
    cfg = config.load_config()
    state_path = config.DATA_OUT / "run_state.json"
    if not state_path.exists():
        print("No run_state.json — run 10_ingest first.")
        return 1
    state = json.loads(state_path.read_text(encoding="utf-8"))
    leads = state.get("leads", [])
    if args.limit:
        leads = leads[: args.limit]

    budget = BudgetGuard(config.budget_cap_eur())
    per_domain = classify.cost_per_domain_eur(cfg)
    api_key = config.env(classify.api_key_env(cfg))
    live = not args.dry_run and bool(api_key)
    db = SupabaseWriter(dry_run=args.dry_run)

    # Which domains need a NEW paid call (eligible, no result cache / --force)?
    need_call: list[str] = []
    if live:
        for lead in leads:
            c = read_cache(lead["dominio"])
            if c and c.get("text") and (args.force or read_flags_cache(lead["dominio"]) is None):
                need_call.append(lead["dominio"])
    affordable = budget.affordable(per_domain)
    allowed = set(need_call[:affordable])
    truncated = max(0, len(need_call) - affordable)
    if truncated:
        print(f"budget: cap {budget.cap:.2f} EUR → {len(allowed)}/{len(need_call)} classificazioni LLM ({truncated} rimandate)")

    def classify_one(lead: dict) -> dict:
        domain, lid = lead["dominio"], lead["id"]
        cache = read_cache(domain)
        rows = det_flags(lid, cache or {}, lead.get("seed", {}))
        status, err_msg = "det_only", ""
        parsed = None
        if live and cache and cache.get("text"):
            cached = None if args.force else read_flags_cache(domain)
            if cached is not None:
                parsed, status = cached, "cached"
            elif domain in allowed:
                try:
                    budget.charge("classify", per_domain)
                    parsed = classify.classify_domain(api_key, domain, cache, cfg)
                    write_flags_cache(domain, parsed)
                    status = "classified"
                except Exception as e:  # noqa: BLE001 — one bad domain must not stop the batch
                    err_msg = str(e).split("?")[0]
                    print(f"  classify failed for {domain}: {err_msg}")
                    status = "error"
        if parsed is not None:
            llm = llm_flags(lid, parsed)
            if any(f["tipo"] == "fascia_prezzo" for f in rows):
                llm = [f for f in llm if not f.get("_from_llm")]  # keep code-derived fascia
            for f in llm:
                f.pop("_from_llm", None)
            rows += llm
        return {"domain": domain, "rows": rows, "status": status, "error": err_msg}

    workers = int((cfg.get("concurrency", {}) or {}).get("classify", 10))
    results = run_pool(leads, classify_one, workers)
    all_rows = [r for res in results for r in res["rows"]]
    preview = [{"dominio": res["domain"], "flags": res["rows"]} for res in results]
    st = Counter(res["status"] for res in results)
    fails = [{"domain": r["domain"], "stage": "classify", "error": r.get("error", "")}
             for r in results if r["status"] == "error"]
    if fails:
        merge_errors("classify", fails)

    if all_rows:
        db.insert("flags", all_rows)
    db.flush_dryrun()
    config.DATA_OUT.mkdir(parents=True, exist_ok=True)
    (config.DATA_OUT / "flags_preview.json").write_text(
        json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if args.dry_run:
        est = len([l for l in leads if read_cache(l["dominio"])]) * per_domain
        append_stage("classify", {"leads": len(leads), "est_llm_cost_eur": round(est, 3), "dry_run": True})
        print(f"classify (dry-run): {len(leads)} leads, {len(all_rows)} flag deterministici, est LLM {est:.2f} EUR")
        return 0

    append_stage("classify", {"leads": len(leads), "classified": st["classified"], "cached": st["cached"],
                              "det_only": st["det_only"], "errors": st["error"], "truncated": truncated,
                              "workers": workers, "flags_written": len(all_rows),
                              "budget_spent_eur": round(budget.spent, 4)})
    print(f"classify: {st['classified']} via LLM, {st['cached']} da cache, {st['det_only']} solo-det, "
          f"{st['error']} errori, {len(all_rows)} flag, spent {budget.spent:.3f} EUR ({workers} paralleli)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
