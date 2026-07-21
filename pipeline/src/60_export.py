"""60_export — one CSV per cestino × CON NOME/GENERIC + report.md.

Reads run_state.json (contact fields), cestini.json (assignment + flags), and
qa.json (per-flag approval). Applies the QA gate: a cestino whose driving flag
failed QA (or was never measured) is EXCLUDED — code, not a reminder (§7).
The import into Instantly stays manual (Marco).

  python src/60_export.py [--skip-qa]

--skip-qa emits a PROVISIONAL export before QA (clearly labelled in the report).
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import config
from lib.runlog import append_stage
from lib.scoring import is_cestino_approved


def _load(name: str, default):
    p = config.DATA_OUT / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def _value(col: str, lead: dict, item: dict) -> str:
    if col == "cestino":
        return item["cestino"]
    if col in ("fascia_prezzo", "open_house"):
        return str(item["flags"].get(col, ""))
    return str(lead.get(col, ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-qa", action="store_true")
    args = ap.parse_args()
    config.assert_no_instantly()
    cfg = config.load_config()

    state = _load("run_state.json", {})
    cestini = _load("cestini.json", [])
    if not state or not cestini:
        print("Missing run_state.json / cestini.json — run 10→40 first.")
        return 1
    qa = _load("qa.json", {})
    approved_by_flag = {tipo: v.get("approvato", False) for tipo, v in qa.items()}
    leads_by_dom = {l["dominio"]: l for l in state.get("leads", [])}

    columns = (cfg.get("output", {}) or {}).get("instantly_columns", [])
    split = (cfg.get("output", {}) or {}).get("split_con_nome", True)
    require_qa = not args.skip_qa

    buckets: dict[str, list[dict]] = {}
    excluded, gaps = 0, []
    for item in cestini:
        cestino = item["cestino"]
        if not is_cestino_approved(cestino, approved_by_flag, require_qa=require_qa):
            excluded += 1
            continue
        lead = leads_by_dom.get(item["dominio"], {})
        segment = "CON_NOME" if (split and item.get("con_nome")) else "GENERIC"
        key = f"{cestino}_{segment}"
        buckets.setdefault(key, []).append({c: _value(c, lead, item) for c in columns})
        if item.get("recipe", {}).get("gaps"):
            gaps.append({"dominio": item["dominio"], "cestino": cestino, "gaps": item["recipe"]["gaps"]})

    config.DATA_OUT.mkdir(parents=True, exist_ok=True)
    written = {}
    for key, rows in sorted(buckets.items()):
        path = config.DATA_OUT / f"cestino_{key}.csv"
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=columns)
            w.writeheader()
            w.writerows(rows)
        written[key] = len(rows)

    _write_report(written, excluded, gaps, approved_by_flag, require_qa)
    append_stage("export", {"files": written, "excluded": excluded, "qa_enforced": require_qa})
    label = "PROVVISORIO (QA saltata)" if args.skip_qa else "QA applicata"
    print(f"export [{label}]: {sum(written.values())} lead in {len(written)} file, {excluded} esclusi da QA")
    return 0


def _write_report(written, excluded, gaps, approved_by_flag, require_qa) -> None:
    lines = ["# Report cestini", ""]
    if not approved_by_flag:
        lines.append("> ⚠️ Nessun QA presente (`data/out/qa.json` mancante). "
                     + ("Export bloccato per i cestini con flag driver non verificati (Regola Zero)."
                        if require_qa else "Export **provvisorio**: QA saltata con --skip-qa.") )
        lines.append("")
    lines.append("## File generati (lead per cestino × segmento)")
    if written:
        for key, n in sorted(written.items()):
            lines.append(f"- `cestino_{key}.csv` — {n} lead")
    else:
        lines.append("- (nessuno)")
    lines += ["", f"**Esclusi dal gate QA:** {excluded}", ""]
    lines.append("## Stato QA per flag")
    if approved_by_flag:
        for tipo, ok in sorted(approved_by_flag.items()):
            lines.append(f"- {tipo}: {'✓ approvato' if ok else '✗ sopra soglia → esclude i cestini driver'}")
    else:
        lines.append("- (QA non ancora eseguita)")
    if gaps:
        lines += ["", "## Buchi di sequenza (slot senza email approvata)"]
        for g in gaps[:50]:
            lines.append(f"- {g['dominio']} ({g['cestino']}): {', '.join(g['gaps'])}")
    (config.DATA_OUT / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
