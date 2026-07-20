"""Pre-classification exclusions (root CLAUDE.md · module §Esclusioni).

Brand exclusion is deterministic from the CSV (company/domain) and runs at
ingest. `solo_affitti` is content-based and is decided later in classify, only
when NO sale signal is present.
"""
from __future__ import annotations


def excluded_by_brand(company: str, domain: str, brands: list[str]) -> str | None:
    """Return the matched brand (→ exclude) or None. Franchising/brands like
    tecnocasa, remax, gabetti … are out of scope."""
    hay = f"{company} {domain}".lower()
    for b in brands or []:
        if b.lower() in hay:
            return b
    return None
