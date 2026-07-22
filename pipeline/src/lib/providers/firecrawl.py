"""Firecrawl enrichment — JS-render fallback for sites the free fetch can't read.

Only ~a handful of domains render their content client-side (empty HTML to a
plain GET). Firecrawl runs a real browser and returns the rendered text. Used
ONLY as a fallback in 20_enrich when scrape_direct yields too little, so it
costs credits on the hard cases, not the whole list.
"""
from __future__ import annotations

import requests

API = "https://api.firecrawl.dev/v1/scrape"


def _cfg(cfg: dict) -> dict:
    return ((cfg.get("providers", {}) or {}).get("firecrawl", {}) or {})


def enrich_domain(token: str, domain: str, cfg: dict, timeout: int = 45) -> dict:
    """Scrape the homepage with JS rendering → frag matching the Apify shape."""
    frag: dict = {"annunci": [], "text": "", "sources": [], "providers": ["firecrawl"]}
    body = {
        "url": f"https://{domain}",
        "formats": ["markdown"],
        "onlyMainContent": True,
        "waitFor": int(_cfg(cfg).get("wait_ms", 2500)),
    }
    try:
        r = requests.post(
            API, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=body, timeout=timeout,
        )
        r.raise_for_status()
        data = (r.json() or {}).get("data", {}) or {}
    except Exception as e:  # noqa: BLE001 — one bad domain must not kill the batch
        frag["errors"] = [str(e).split("?")[0]]
        return frag

    text = (data.get("markdown") or data.get("text") or "").strip()
    frag["text"] = text[:20000]
    url = (data.get("metadata", {}) or {}).get("sourceURL") or f"https://{domain}"
    frag["sources"].append({"url": url, "kind": "firecrawl"})
    if not frag["text"]:
        frag["errors"] = ["no content"]
    return frag


def cost_per_domain_eur(cfg: dict) -> float:
    return float(_cfg(cfg).get("cost_per_domain_eur", 0.001))
