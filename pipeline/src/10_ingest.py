"""10_ingest — normalize, dedup per domain, brand-exclude, validate email.

Reads the wave CSV (Apollo export), precomputes the cheap CSV signals (§3),
creates the pipeline_run, and writes the leads. Hands off to 20_enrich via
data/out/run_state.json.

  python src/10_ingest.py [--dry-run] [--limit N] [--input path/to.csv]

--dry-run touches no network and no DB (email_valid stays null; rows are dumped
to data/out/db_dryrun.json). Guardrail: aborts if INSTANTLY_API_KEY is present.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # make `lib` importable

from lib import config
from lib.budget import BudgetGuard
from lib.csvmap import nome_seed, read_rows, struttura_seed
from lib.db import SupabaseWriter
from lib.domains import dedup_by_domain
from lib.exclusions import excluded_by_brand
from lib.flags_det import zona_from_state
from lib.providers import millionverifier
from lib.runlog import append_stage


def find_input_csv() -> Path | None:
    csvs = sorted(config.DATA_IN.glob("*.csv"))
    return csvs[0] if csvs else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--input", type=str, default="")
    ap.add_argument("--with-email", action="store_true", help="tieni solo i lead con email")
    args = ap.parse_args()

    config.assert_no_instantly()
    cfg = config.load_config()
    mapping = cfg.get("input_mapping", {})
    brands = (cfg.get("exclusions", {}) or {}).get("brands", [])

    input_path = Path(args.input) if args.input else find_input_csv()
    if not input_path or not input_path.exists():
        print(f"No input CSV (looked in {config.DATA_IN}). Drop the wave export there.")
        return 1

    rows = read_rows(input_path, mapping)
    n_raw = len(rows)
    rows = dedup_by_domain(rows)
    kept, excluded = [], 0
    for r in rows:
        if excluded_by_brand(r["company"], r["dominio"], brands):
            excluded += 1
            continue
        kept.append(r)
    if args.with_email:
        kept = [r for r in kept if r["email"]]
    if args.limit:
        kept = kept[: args.limit]

    budget = BudgetGuard(config.budget_cap_eur())
    db = SupabaseWriter(dry_run=args.dry_run)
    slug = config.client_slug()

    run = db.insert_one(
        "pipeline_runs",
        {"client_slug": slug, "n_input": n_raw, "provider_usati": []},
    )
    run_id = run["id"]

    lead_rows, manifest = [], []
    for r in kept:
        email = r["email"]
        email_valid = None
        if not args.dry_run and email:
            key = config.env("MILLIONVERIFIER_API")
            if key:
                budget.charge("millionverifier", millionverifier.cost_per_email_eur(cfg))
                try:
                    email_valid, _ = millionverifier.verify(key, email)
                except Exception as e:  # noqa: BLE001 — one bad email must not stop ingest
                    print(f"  email check failed for {email}: {e}")
        seed = {
            "struttura": struttura_seed(r["employees"], r["retail_locations"]),
            "nome_usabile": nome_seed(r["title"], r["seniority"]),
            "zona": zona_from_state(r["state"]),
            "city": r["city"],
            "state": r["state"],
        }
        lead_rows.append(
            {
                "client_slug": slug,
                "run_id": run_id,
                "dominio": r["dominio"],
                "company": r["company"],
                "email": email,
                "email_valid": email_valid,
                "city": r["city"],
                "provincia": r["state"],
            }
        )
        manifest.append({
            "dominio": r["dominio"], "email": email,
            "first_name": r["first_name"], "last_name": r["last_name"],
            "company": r["company"], "city": r["city"], "seed": seed,
        })

    inserted = db.insert("leads", lead_rows)
    for lead, man in zip(inserted, manifest):
        man["id"] = lead["id"]
    db.flush_dryrun()

    state = {
        "run_id": run_id,
        "client_slug": slug,
        "dry_run": args.dry_run,
        "input": str(input_path),
        "leads": manifest,
        "budget_spent_eur": round(budget.spent, 4),
    }
    config.DATA_OUT.mkdir(parents=True, exist_ok=True)
    (config.DATA_OUT / "run_state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    append_stage(
        "ingest",
        {
            "input": str(input_path),
            "n_raw": n_raw,
            "n_deduped": len(rows),
            "n_excluded_brand": excluded,
            "n_leads": len(manifest),
            "budget_spent_eur": round(budget.spent, 4),
            "dry_run": args.dry_run,
        },
    )

    print(
        f"ingest: {n_raw} raw -> {len(rows)} deduped -> {excluded} brand-excluded -> "
        f"{len(manifest)} leads (run {run_id}, dry_run={args.dry_run}, spent {budget.spent:.3f} EUR)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
