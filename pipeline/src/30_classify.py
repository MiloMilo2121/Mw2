"""30_classify — extract flags. Reads ONLY the cache (never the network).

Deterministic flags (fascia_prezzo, invenduto_ratio, zona) are computed in CODE;
open_house / struttura / nome_usabile / solo_affitti come from the LLM, each with
evidence + source (§5). Writes rows to the `flags` table and a human-readable
data/out/flags_preview.json for the 20-domain manual check.

  python src/30_classify.py [--dry-run] [--limit N]

--dry-run estimates LLM cost and still computes the deterministic flags from any
cache present. Guardrail: aborts if INSTANTLY_API_KEY is present.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import classify, config
from lib.budget import BudgetExceeded, BudgetGuard
from lib.cache import read_cache
from lib.db import SupabaseWriter
from lib.flags_det import invenduto_ratio, median_price
from lib.runlog import append_stage


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
    for tipo in ("open_house", "struttura", "nome_usabile"):
        f = parsed.get(tipo) or {}
        rows.append({"lead_id": lead_id, "tipo": tipo, "valore": f.get("value"),
                     "confidence": f.get("confidence"), "evidenza": f.get("evidence"),
                     "source_url": f.get("source_url"), "provider": "llm"})
    sa = parsed.get("solo_affitti") or {}
    if sa:
        rows.append({"lead_id": lead_id, "tipo": "solo_affitti", "valore": str(sa.get("value")),
                     "evidenza": sa.get("evidence"), "provider": "llm"})
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
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
    db = SupabaseWriter(dry_run=args.dry_run)

    all_rows, preview = [], []
    classified, det_only, errors = 0, 0, 0
    for lead in leads:
        domain = lead["dominio"]
        cache = read_cache(domain)
        rows = det_flags(lead["id"], cache or {}, lead.get("seed", {}))

        do_llm = bool(cache and cache.get("text") and api_key and not args.dry_run)
        if do_llm:
            try:
                budget.charge("classify", per_domain)
                parsed = classify.classify_domain(api_key, domain, cache, cfg)
                rows += llm_flags(lead["id"], parsed)
                # fascia_prezzo from the LLM when the crawler gave no structured
                # listings (website-content-crawler returns text, not prices).
                if not any(f["tipo"] == "fascia_prezzo" for f in rows):
                    fp = parsed.get("fascia_prezzo") or {}
                    med = fp.get("mediana_eur")
                    if isinstance(med, (int, float)) and med > 0:
                        rows.append({"lead_id": lead["id"], "tipo": "fascia_prezzo",
                                     "valore": str(int(med)),
                                     "evidenza": f"{fp.get('n_annunci_letti', '?')} annunci (LLM)",
                                     "provider": "llm"})
                classified += 1
            except BudgetExceeded as e:
                print(f"STOP (budget): {e}")
                break
            except Exception as e:  # noqa: BLE001 — one bad domain must not stop the batch
                print(f"  classify failed for {domain}: {e}")
                errors += 1
        else:
            det_only += 1
        all_rows += rows
        preview.append({"dominio": domain, "flags": rows})

    if all_rows:
        db.insert("flags", all_rows)
    db.flush_dryrun()

    config.DATA_OUT.mkdir(parents=True, exist_ok=True)
    (config.DATA_OUT / "flags_preview.json").write_text(
        json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if args.dry_run:
        est = len([l for l in leads if read_cache(l["dominio"])]) * per_domain
        append_stage("classify", {"leads": len(leads), "det_only": det_only,
                                   "est_llm_cost_eur": round(est, 3), "dry_run": True})
        print(f"classify (dry-run): {len(leads)} leads, {len(all_rows)} deterministic flags, "
              f"est LLM {est:.2f} EUR")
        return 0

    append_stage("classify", {"leads": len(leads), "classified_llm": classified,
                              "det_only": det_only, "errors": errors,
                              "flags_written": len(all_rows), "budget_spent_eur": round(budget.spent, 4)})
    print(f"classify: {classified} via LLM, {det_only} deterministic-only, {errors} errors, "
          f"{len(all_rows)} flags, spent {budget.spent:.3f} EUR")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
