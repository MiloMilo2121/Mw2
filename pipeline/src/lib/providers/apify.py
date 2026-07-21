"""Apify enrichment — crawl the agency's own website → text for the classifier.

We start from the agency DOMAIN (not an immobiliare.it URL), so the direct,
robust path is apify/website-content-crawler: it crawls the site (home +
internal pages) and returns clean text. The LLM then extracts every flag
(open_house, struttura, nome, prezzi) from that text.

A dedicated immobiliare.it actor (structured prices/dates) is a future upgrade —
it needs a domain → immobiliare.it profile mapping we don't have yet.

Never raises for a single bad domain (records the error instead).
"""
from __future__ import annotations

import requests

APIFY_BASE = "https://api.apify.com/v2"


def run_actor(token: str, actor_id: str, run_input: dict, timeout: int = 300) -> list:
    # Apify path uses "username~actorname". Auth via header (NOT ?token= in the
    # URL) so the token never leaks into request/error messages.
    path_id = actor_id.replace("/", "~")
    url = f"{APIFY_BASE}/acts/{path_id}/run-sync-get-dataset-items"
    res = requests.post(url, json=run_input, headers={"Authorization": f"Bearer {token}"}, timeout=timeout)
    res.raise_for_status()
    data = res.json()
    return data if isinstance(data, list) else data.get("items", [])


def _apify_cfg(cfg: dict) -> dict:
    return (cfg.get("providers", {}) or {}).get("apify", {}) or {}


def enrich_domain(token: str, domain: str, cfg: dict) -> dict:
    a = _apify_cfg(cfg)
    actor = a.get("actor") or "apify/website-content-crawler"
    run_input = {
        "startUrls": [{"url": f"https://{domain}"}],
        "crawlerType": a.get("crawler_type", "cheerio"),
        "maxCrawlPages": a.get("max_pages", 6),
        "maxCrawlDepth": a.get("max_depth", 1),
        "saveMarkdown": True,
    }
    result: dict = {"annunci": [], "text": "", "sources": [], "providers": ["website-content-crawler"]}
    try:
        items = run_actor(token, actor, run_input)
    except Exception as e:  # one bad domain must not kill the batch
        result["errors"] = [str(e)]
        return result

    texts: list[str] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        text = (it.get("text") or it.get("markdown") or "").strip()
        if text:
            texts.append(text)
        url = it.get("url")
        if url:
            result["sources"].append({"url": url, "kind": "site"})
    result["text"] = "\n\n".join(texts)[:20000]
    return result


def cost_per_domain_eur(cfg: dict) -> float:
    return float(_apify_cfg(cfg).get("cost_per_domain_eur", 0.02))
