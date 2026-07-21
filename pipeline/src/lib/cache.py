"""Per-domain enrichment cache. Providers write here; the classifier reads ONLY
from here (never the network). This is also the resume mechanism: a re-run skips
domains already cached, so an interrupted run never re-pays (§6).
"""
from __future__ import annotations

import json

from .config import DATA_CACHE


def cache_path(domain: str):
    safe = domain.replace("/", "_").replace("\\", "_")
    return DATA_CACHE / f"{safe}.json"


def read_cache(domain: str) -> dict | None:
    p = cache_path(domain)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def write_cache(domain: str, data: dict) -> None:
    DATA_CACHE.mkdir(parents=True, exist_ok=True)
    cache_path(domain).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def is_cached(domain: str) -> bool:
    return cache_path(domain).exists()
