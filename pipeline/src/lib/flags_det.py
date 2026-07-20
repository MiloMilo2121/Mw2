"""Deterministic flags — computed by CODE, not the LLM (root CLAUDE.md §5).

  fascia_prezzo   = median of listing prices
  invenduto_ratio = share of listings online for more than `days` days
  zona            = macro-area mapped from the region/province

These never guess: with no data they return None / '' (→ unknown).
"""
from __future__ import annotations

from datetime import datetime, timezone
from statistics import median


def median_price(annunci: list[dict]) -> float | None:
    prices = [
        float(a["prezzo"])
        for a in annunci
        if isinstance(a.get("prezzo"), (int, float)) and a.get("prezzo") and a["prezzo"] > 0
    ]
    return float(median(prices)) if prices else None


def _parse_date(value) -> datetime | None:
    if not value:
        return None
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s[: len(fmt) + 2], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    # ISO with timezone / extra precision
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def invenduto_ratio(annunci: list[dict], now: datetime | None = None, days: int = 120) -> float | None:
    """Share of dated listings older than `days`. None when no listing has a date."""
    now = now or datetime.now(timezone.utc)
    dates = [d for a in annunci if (d := _parse_date(a.get("data_pubblicazione")))]
    if not dates:
        return None
    old = sum(1 for d in dates if (now - d).days > days)
    return old / len(dates)


# Region/province (Apollo "Company State") → macro-zona used by sequences.yaml.
# Extendable; anything unmapped stays '' (unknown, no assumption).
_ZONE_MAP = {
    "lombardia": "lombardia",
    "lombardy": "lombardia",
    "veneto": "veneto_triveneto",
    "trentino-alto adige": "veneto_triveneto",
    "trentino-south tyrol": "veneto_triveneto",
    "friuli-venezia giulia": "veneto_triveneto",
    "friuli venezia giulia": "veneto_triveneto",
    "emilia-romagna": "emilia",
    "emilia romagna": "emilia",
}


def zona_from_state(state: str) -> str:
    return _ZONE_MAP.get((state or "").strip().lower(), "")
