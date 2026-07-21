"""50_qa — stratified sample for manual verification, then measure error.

Default run: draw a stratified sample (by cestino) from cestini.json and write
qa/sample.csv for Marco to mark (`corretto`: 1 right / 0 wrong).
--recompute: read the marked sample, compute error_rate per flag, write the
qa_results rows + data/out/qa.json. A flag over the threshold → approvato=false
→ 60_export excludes the cestini it drives (Regola Zero / §7).

  python src/50_qa.py            # build qa/sample.csv
  python src/50_qa.py --recompute
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import config
from lib.db import SupabaseWriter
from lib.runlog import append_stage
from lib.scoring import error_rate, qa_gate, stratified_sample_size

VERIFIABLE = ("open_house", "struttura", "nome_usabile", "fascia_prezzo")


def _state() -> dict:
    p = config.DATA_OUT / "run_state.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def build_sample(cfg: dict) -> int:
    cestini = json.loads((config.DATA_OUT / "cestini.json").read_text(encoding="utf-8"))
    total = (cfg.get("qa", {}) or {}).get("sample_size", 30)
    by_cestino: dict[str, list] = {}
    for item in cestini:
        by_cestino.setdefault(item["cestino"], []).append(item)

    per = stratified_sample_size(len(by_cestino) or 1, total)
    rng = random.Random(_state().get("run_id", "seed"))
    rows = []
    for cestino, items in sorted(by_cestino.items()):
        chosen = items if len(items) <= per else rng.sample(items, per)
        for it in chosen:
            for tipo in VERIFIABLE:
                val = it["flags"].get(tipo)
                if val not in (None, ""):
                    rows.append({"dominio": it["dominio"], "cestino": cestino,
                                 "flag_tipo": tipo, "valore": val, "corretto": ""})

    config.QA_DIR.mkdir(parents=True, exist_ok=True)
    out = config.QA_DIR / "sample.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["dominio", "cestino", "flag_tipo", "valore", "corretto"])
        w.writeheader()
        w.writerows(rows)
    append_stage("qa_sample", {"rows": len(rows), "strata": sorted(by_cestino), "file": str(out)})
    print(f"qa: wrote {len(rows)} rows to {out} — mark `corretto` (1/0), then run --recompute")
    return 0


def recompute(cfg: dict) -> int:
    sample = config.QA_DIR / "sample.csv"
    if not sample.exists():
        print("No qa/sample.csv — run 50_qa (without --recompute) first.")
        return 1
    max_err = (cfg.get("qa", {}) or {}).get("max_error_accettabile", 0.10)
    marks: dict[str, list[int]] = {}
    with open(sample, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            v = (r.get("corretto") or "").strip()
            if v in ("0", "1"):
                marks.setdefault(r["flag_tipo"], []).append(int(v))

    state = _state()
    db = SupabaseWriter(dry_run=bool(state.get("dry_run")))
    run_id = state.get("run_id")
    rows, summary = [], {}
    for tipo, m in sorted(marks.items()):
        rate = error_rate(m)
        approved = qa_gate(rate, max_err)
        summary[tipo] = {"n": len(m), "error_rate": round(rate, 3), "approvato": approved}
        rows.append({"run_id": run_id, "flag_tipo": tipo, "campione_n": len(m),
                     "errori_n": sum(1 for x in m if x == 0), "error_rate": rate, "approvato": approved})
    if rows:
        db.insert("qa_results", rows)
    db.flush_dryrun()
    (config.DATA_OUT / "qa.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    append_stage("qa_recompute", {"flags": summary, "max_error": max_err})
    print("qa recompute: " + ", ".join(f"{k} {v['error_rate']*100:.0f}%{'✓' if v['approvato'] else '✗'}"
                                        for k, v in summary.items()))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recompute", action="store_true")
    args = ap.parse_args()
    config.assert_no_instantly()
    cfg = config.load_config()
    return recompute(cfg) if args.recompute else build_sample(cfg)


if __name__ == "__main__":
    raise SystemExit(main())
