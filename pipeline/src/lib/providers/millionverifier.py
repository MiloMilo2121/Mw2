"""MillionVerifier email validation (network)."""
from __future__ import annotations

import requests

MV_URL = "https://api.millionverifier.com/api/v3/"


def verify(api_key: str, email: str, timeout: int = 20) -> tuple[bool, str]:
    """Return (is_valid, result_label). 'ok' → deliverable."""
    res = requests.get(MV_URL, params={"api": api_key, "email": email}, timeout=timeout)
    res.raise_for_status()
    data = res.json()
    result = str(data.get("result", "")).lower()
    return result == "ok", result


def cost_per_email_eur(cfg: dict) -> float:
    return float(((cfg.get("providers", {}) or {}).get("millionverifier", {}) or {}).get("cost_per_email_eur", 0.0006))
