"""40_score — assign each lead to a cestino (A-E) + resolve its sequence recipe.

Reads run_state.json (leads + seed) and flags_preview.json (flags per domain),
runs the deterministic scoring tree, resolves the sequences.yaml recipe applying
feedback.yaml (giallo/scartato → fallback), and writes the `cestini` rows +
data/out/cestini.json (handoff to 50_qa / 60_export).

  python src/40_score.py [--limit N]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import config
from lib.db import SupabaseWriter
from lib.runlog import append_stage
from lib.scoring import assign_cestino, flags_to_dict, is_solo_affitti, resolve_sequence


def _load(name: str) -> dict:
    p = config.DATA_OUT / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    config.assert_no_instantly()

    state = _load("run_state.json")
    if not state:
        print("No run_state.json — run 10_ingest first.")
        return 1
    leads = state.get("leads", [])
    if args.limit:
        leads = leads[: args.limit]

    preview = _load("flags_preview.json") or []
    flags_by_domain = {p["dominio"]: p.get("flags", []) for p in preview}

    with open(config.ROOT / "sequences.yaml", encoding="utf-8") as f:
        sequences = yaml.safe_load(f) or {}
    fb_path = config.DATA_IN / "feedback.yaml"
    feedback = yaml.safe_load(fb_path.read_text(encoding="utf-8")) if fb_path.exists() else {}

    db = SupabaseWriter(dry_run=bool(state.get("dry_run")))
    run_id = state["run_id"]

    rows, handoff, counts = [], [], {}
    excluded_sa = 0
    for lead in leads:
        dom = lead["dominio"]
        flags = flags_to_dict(flags_by_domain.get(dom, []), lead.get("seed"))
        if is_solo_affitti(flags):
            excluded_sa += 1
            continue  # rentals-only → not a target (§Esclusioni)
        cestino, motivo = assign_cestino(flags)
        zona = (lead.get("seed") or {}).get("zona", "")
        recipe = resolve_sequence(cestino, zona, sequences, feedback)
        con_nome = flags.get("nome_usabile") == "si"
        counts[cestino] = counts.get(cestino, 0) + 1
        rows.append({
            "lead_id": lead["id"], "run_id": run_id, "cestino": cestino, "motivo": motivo,
            "sequenza_id": recipe["sequenza_id"], "tono": recipe["tono"], "con_nome": con_nome,
        })
        handoff.append({
            "dominio": dom, "lead_id": lead["id"], "email": lead.get("email"), "cestino": cestino,
            "motivo": motivo, "con_nome": con_nome, "flags": flags, "recipe": recipe,
        })

    if rows:
        db.insert("cestini", rows)
    db.flush_dryrun()

    (config.DATA_OUT / "cestini.json").write_text(
        json.dumps(handoff, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    append_stage("score", {"leads": len(leads), "by_cestino": counts, "excluded_solo_affitti": excluded_sa})
    print(f"score: {len(leads)} leads ({excluded_sa} esclusi solo-affitti) → "
          + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
