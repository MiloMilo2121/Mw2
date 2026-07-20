"""Domain normalisation + dedup — the dedup key for the whole pipeline."""
from __future__ import annotations

from urllib.parse import urlparse


def normalize_domain(raw: str) -> str:
    """A bare, lowercased host: 'https://www.Rossi-Immobili.it/annunci' → 'rossi-immobili.it'."""
    if not raw:
        return ""
    s = raw.strip().lower()
    if "://" not in s:
        s = "http://" + s
    host = urlparse(s).netloc or ""
    host = host.split("@")[-1].split(":")[0]  # strip creds / port
    if host.startswith("www."):
        host = host[4:]
    return host.strip("/")


def dedup_by_domain(rows: list[dict], key: str = "dominio") -> list[dict]:
    """Keep the first row per domain; drop rows with an empty/duplicate domain."""
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        d = (r.get(key) or "").strip()
        if not d or d in seen:
            continue
        seen.add(d)
        out.append(r)
    return out
