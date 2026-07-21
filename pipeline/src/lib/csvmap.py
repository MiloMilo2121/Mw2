"""Map the wave CSV (Apollo export) → canonical lead rows, and precompute the
cheap signals from the CSV itself (§3): spend API budget only on what's unknown.
"""
from __future__ import annotations

import csv
from pathlib import Path

from .domains import normalize_domain


def _get(row: dict, mapping: dict, key: str) -> str:
    return (row.get(mapping.get(key, ""), "") or "").strip()


def map_row(row: dict, mapping: dict) -> dict:
    """One CSV row → canonical fields. Fully config-driven: every source column
    (incl. the seed signals) comes from input_mapping, so a new export format is
    a config change, not a code change."""
    return {
        "dominio": normalize_domain(_get(row, mapping, "domain") or _get(row, mapping, "domain_fallback")),
        "company": _get(row, mapping, "company"),
        "first_name": _get(row, mapping, "first_name"),
        "last_name": _get(row, mapping, "last_name"),
        "email": _get(row, mapping, "email"),
        "employees": _get(row, mapping, "employees"),
        "city": _get(row, mapping, "city"),
        "keywords": _get(row, mapping, "keywords"),
        "description": _get(row, mapping, "description"),
        # Seed signals (§3) — read via mapping keys; empty when the column is absent.
        "state": _get(row, mapping, "state") or _get(row, mapping, "province"),
        "title": _get(row, mapping, "title"),
        "seniority": _get(row, mapping, "seniority"),
        "retail_locations": _get(row, mapping, "retail_locations"),
    }


def read_rows(path: str | Path, mapping: dict) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [map_row(r, mapping) for r in csv.DictReader(f)]


def _to_int(x: str) -> int | None:
    try:
        return int(float(str(x).strip()))
    except (ValueError, TypeError):
        return None


def struttura_seed(employees: str, retail_locations: str) -> str:
    """Initial `struttura` hint from headcount / #locations. NOT the final flag —
    the LLM confirms with site evidence (§5). Returns a hint or '' (unknown)."""
    loc = _to_int(retail_locations)
    emp = _to_int(employees)
    if loc is not None and loc >= 4:
        return "mini_franchising"
    if loc in (2, 3):
        return "multi_sede_piccola"
    if emp is not None and 0 < emp <= 5:
        return "indipendente"
    return ""


_OWNER_WORDS = (
    "founder",
    "owner",
    "titolare",
    "fondatore",
    "ceo",
    "amministratore",
    "proprietario",
    "socio",
    "partner",
)


def nome_seed(title: str, seniority: str) -> str:
    """Hint that a usable owner name MIGHT exist (owner-ish role). Confirmation
    still requires site evidence (§5), so this is only 'si' or '' — never 'no'."""
    blob = f"{title} {seniority}".lower()
    return "si" if any(w in blob for w in _OWNER_WORDS) else ""
