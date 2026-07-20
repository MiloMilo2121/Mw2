"""Apify enrichment: immobiliare.it actor with an Idealista fallback.

The actor ids and their input schema live in config.yaml (providers.apify) and
MUST be set before a live run — the parser here is deliberately defensive about
field names because actor output shapes vary. Returns a cache-shaped fragment;
never raises for a single bad domain (records the error instead).
"""
from __future__ import annotations

import requests

APIFY_BASE = "https://api.apify.com/v2"


def run_actor(token: str, actor_id: str, run_input: dict, timeout: int = 300) -> list:
    url = f"{APIFY_BASE}/acts/{actor_id}/run-sync-get-dataset-items?token={token}"
    res = requests.post(url, json=run_input, timeout=timeout)
    res.raise_for_status()
    data = res.json()
    return data if isinstance(data, list) else data.get("items", [])


def _to_price(v) -> float | None:
    if isinstance(v, (int, float)):
        return float(v) if v > 0 else None
    if isinstance(v, str):
        digits = "".join(ch for ch in v if ch.isdigit())
        return float(digits) if digits else None
    return None


def parse_items(items: list, source: str) -> dict:
    """Actor items → {annunci, text, sources}. Tolerant of field-name variants."""
    annunci, texts, sources = [], [], []
    for it in items:
        if not isinstance(it, dict):
            continue
        price = _to_price(it.get("price") or it.get("prezzo"))
        pub = it.get("publishedAt") or it.get("date") or it.get("data_pubblicazione")
        url = it.get("url") or it.get("link")
        if price or pub:
            annunci.append({"prezzo": price, "data_pubblicazione": pub, "url": url})
        for k in ("title", "titolo", "description", "descrizione", "text"):
            t = it.get(k)
            if isinstance(t, str) and t.strip():
                texts.append(t.strip())
        if url:
            sources.append({"url": url, "kind": source})
    return {"annunci": annunci, "text": "\n".join(texts)[:20000], "sources": sources}


def enrich_domain(token: str, domain: str, cfg: dict) -> dict:
    apify_cfg = (cfg.get("providers", {}) or {}).get("apify", {}) or {}
    result: dict = {"annunci": [], "text": "", "sources": [], "providers": []}
    for key, source in (("actor_immobiliare", "immobiliare"), ("actor_idealista", "idealista")):
        actor = apify_cfg.get(key)
        if not actor:
            continue
        try:
            items = run_actor(
                token, actor, {"domain": domain, "maxItems": apify_cfg.get("max_items", 40)}
            )
        except Exception as e:  # one bad domain must not kill the batch
            result.setdefault("errors", []).append(f"{source}: {e}")
            continue
        parsed = parse_items(items, source)
        result["providers"].append(source)
        result["annunci"] += parsed["annunci"]
        result["text"] = f"{result['text']}\n{parsed['text']}".strip()
        result["sources"] += parsed["sources"]
        if parsed["annunci"]:
            break  # primary source produced listings — no need for the fallback
    return result


def cost_per_domain_eur(cfg: dict) -> float:
    return float(((cfg.get("providers", {}) or {}).get("apify", {}) or {}).get("cost_per_domain_eur", 0.05))
