"""FREE enrichment — direct multi-page fetch (requests, no browser, no cost).

The Apify homepage-only crawl starved two flags: `struttura` (needs the
chi-siamo page) and `fascia_prezzo` (needs the listings page). This provider
fetches a small, prioritised set of pages with plain HTTP and returns clean
text — €0 per domain. It's the PRIMARY provider; Firecrawl (JS) and Apify are
fallbacks only when this yields too little (see 20_enrich).

Fast by design: resolve the working base (www vs apex) once, then fetch the
homepage + the FIRST listings page that responds + the FIRST chi-siamo page —
~3 requests/domain, not the full cross-product.
"""
from __future__ import annotations

import re

import requests

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Prioritised path groups: try each within a group until one responds, then move on.
LISTING_PATHS = ["immobili", "annunci", "immobili-in-vendita", "vendite", "case-in-vendita", "immobili/vendita"]
ABOUT_PATHS = ["chi-siamo", "agenzia", "la-nostra-storia", "about", "chi-siamo-2"]

_TAG = re.compile(r"<[^>]+>")
_SCRIPT = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.S | re.I)
_WS = re.compile(r"\s+")


def html_to_text(html: str, cap: int = 20000) -> str:
    """Strip scripts/styles/tags → collapsed text. Pure/testable."""
    if not html:
        return ""
    t = _SCRIPT.sub(" ", html)
    t = _TAG.sub(" ", t)
    return _WS.sub(" ", t).strip()[:cap]


def _paths_cfg(cfg: dict) -> dict:
    return ((cfg.get("providers", {}) or {}).get("scrape_direct", {}) or {})


def _get(session: requests.Session, url: str, timeout: int) -> str | None:
    try:
        r = session.get(url, timeout=timeout, allow_redirects=True)
    except requests.RequestException:
        return None
    ct = r.headers.get("content-type", "")
    if r.status_code == 200 and "text/html" in ct:
        return r.text
    return None


def enrich_domain(domain: str, cfg: dict) -> dict:
    """Return an enrichment frag {annunci, text, sources, providers, errors?}
    matching the Apify shape, using only free HTTP fetches."""
    a = _paths_cfg(cfg)
    timeout = int(a.get("timeout_s", 12))
    cap = int(a.get("cap_chars", 20000))
    frag: dict = {"annunci": [], "text": "", "sources": [], "providers": ["scrape_direct"]}

    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9"})

    # 1) Resolve the working base (www first, then apex).
    home_html = base = None
    for cand in (f"https://www.{domain}", f"https://{domain}"):
        home_html = _get(session, cand + "/", timeout)
        if home_html:
            base = cand
            break
    if not home_html:
        frag["errors"] = ["no content"]
        return frag

    texts = [html_to_text(home_html, cap)]
    frag["sources"].append({"url": base + "/", "kind": "home"})

    # 2) First listings page that responds (prices → fascia_prezzo).
    for p in LISTING_PATHS:
        html = _get(session, f"{base}/{p}", timeout)
        if html:
            texts.append(html_to_text(html, cap))
            frag["sources"].append({"url": f"{base}/{p}", "kind": "listings"})
            break

    # 3) First chi-siamo page that responds (struttura / nome titolare).
    for p in ABOUT_PATHS:
        html = _get(session, f"{base}/{p}", timeout)
        if html:
            texts.append(html_to_text(html, cap))
            frag["sources"].append({"url": f"{base}/{p}", "kind": "about"})
            break

    frag["text"] = "\n\n".join(t for t in texts if t)[:cap]
    if not frag["text"]:
        frag["errors"] = ["no content"]
    return frag


def cost_per_domain_eur(cfg: dict) -> float:
    return 0.0  # free
