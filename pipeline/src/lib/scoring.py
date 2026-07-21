"""Deterministic cestino assignment, sequence resolution, and the QA gate.

Pure functions (no I/O) so the whole scoring tree, feedback fallback logic, and
the "error_rate > threshold → excluded" gate (§7) are unit-testable offline.
"""
from __future__ import annotations

import math

PRICE_THRESHOLD = 150000

# Which flags DRIVE each cestino → those are the flags whose QA error gates export.
DRIVING_FLAGS = {
    "A": ["open_house", "struttura"],
    "B": ["struttura", "fascia_prezzo"],
    "C": ["struttura", "fascia_prezzo"],
    "D": ["struttura"],
    "E": [],  # catch-all: nothing critical, never blocked
}


def flags_to_dict(flag_rows: list[dict], seed: dict | None = None) -> dict:
    """Reduce flag rows → {tipo: valore}. Seed fills struttura/zona when the
    classifier left them unknown (the CSV seed is a legitimate deterministic
    fallback for those two)."""
    out: dict = {}
    for f in flag_rows:
        tipo, val = f.get("tipo"), f.get("valore")
        if tipo and val not in (None, ""):
            out.setdefault(tipo, val)
    seed = seed or {}
    for k in ("struttura", "zona"):
        if not out.get(k) and seed.get(k):
            out[k] = seed[k]
    return out


def _price(flags: dict) -> float | None:
    v = flags.get("fascia_prezzo")
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def assign_cestino(flags: dict, threshold: int = PRICE_THRESHOLD) -> tuple[str, str]:
    """Return (cestino, motivo). Evaluated in priority order A→E."""
    struttura = flags.get("struttura", "")
    open_house = flags.get("open_house", "")
    fascia = _price(flags)
    if open_house == "si" and struttura == "indipendente":
        return "A", "open_house=si & indipendente"
    if struttura == "indipendente" and fascia is not None and fascia >= threshold:
        return "B", f"indipendente & fascia {int(fascia)} >= {threshold}"
    if struttura == "indipendente" and fascia is not None and fascia < threshold:
        return "C", f"indipendente & fascia {int(fascia)} < {threshold}"
    if struttura in ("multi_sede_piccola", "mini_franchising"):
        return "D", f"struttura {struttura}"
    return "E", "unknown/GENERIC (nessuna regola matchata)"


def _status_of(email: str, feedback: dict) -> str:
    v = (feedback.get("email", {}) or {}).get(email)
    if isinstance(v, dict):
        return v.get("stato", "")
    return v or ""


def resolve_sequence(cestino: str, zona: str, sequences: dict, feedback: dict) -> dict:
    """Resolve a cestino recipe: per_zona substitution + fallback to an
    'approvato' email per slot (giallo/scartato are skipped — §feedback rule 1).
    Returns {sequenza_id, tono, giorni, emails:[{slot,email}], gaps:[slot...]}.
    """
    block = (sequences.get("cestini", {}) or {}).get(cestino, {}) or {}
    zone_prova = sequences.get("zone_prova", {}) or {}

    def pick(primary: str, fallbacks: list[str]) -> str | None:
        for cand in [primary, *(fallbacks or [])]:
            if cand == "per_zona":
                cand = zone_prova.get(zona, "")
            if not cand:
                continue
            if _status_of(cand, feedback) == "approvato":
                return cand
        return None

    emails, gaps = [], []
    for step in block.get("step", []) or []:
        chosen = pick(step.get("email", ""), step.get("fallback", []))
        emails.append({"slot": step.get("slot"), "email": chosen})
        if chosen is None:
            gaps.append(step.get("slot"))

    tono_raw = block.get("tono", "")
    tono = "istituzionale" if tono_raw == "istituzionale_sempre" else (feedback.get("tono_note") or "default")
    seq_id = f"{cestino}/{zona}" if zona else cestino
    return {"sequenza_id": seq_id, "tono": tono, "giorni": block.get("giorni", []), "emails": emails, "gaps": gaps}


# ── QA gate (§7) ──────────────────────────────────────────────────────────────

def error_rate(marks: list[int]) -> float:
    """marks: 1 = classifier right, 0 = wrong. Returns share wrong (0 if empty)."""
    if not marks:
        return 0.0
    wrong = sum(1 for m in marks if int(m) == 0)
    return wrong / len(marks)


def qa_gate(rate: float, max_err: float) -> bool:
    """approvato when measured error is within the acceptable threshold."""
    return rate <= max_err


def is_cestino_approved(cestino: str, approved_by_flag: dict[str, bool], require_qa: bool = True) -> bool:
    """A cestino is exportable when every flag that drives it is QA-approved.
    With require_qa, a driving flag not yet measured blocks it (Regola Zero)."""
    for flag in DRIVING_FLAGS.get(cestino, []):
        if flag not in approved_by_flag:
            if require_qa:
                return False
            continue
        if not approved_by_flag[flag]:
            return False
    return True


def stratified_sample_size(n_strata: int, total: int = 30) -> int:
    """Per-stratum sample size for `total` across `n_strata` cestini."""
    return max(1, math.ceil(total / max(1, n_strata)))
