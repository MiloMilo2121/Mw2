"""MillionVerifier email validation (network)."""
from __future__ import annotations

from ..http import request as http_request

MV_URL = "https://api.millionverifier.com/api/v3/"


def verify(api_key: str, email: str, timeout: int = 20) -> tuple[bool, str]:
    """Return (is_valid, result_label). 'ok' → deliverable. Retries on 429/5xx."""
    res = http_request("GET", MV_URL, params={"api": api_key, "email": email}, timeout=timeout, retries=2)
    data = res.json()
    result = str(data.get("result", "")).lower()
    return result == "ok", result


def cost_per_email_eur(cfg: dict) -> float:
    return float(((cfg.get("providers", {}) or {}).get("millionverifier", {}) or {}).get("cost_per_email_eur", 0.0006))
