"""LLM flag extraction — provider-agnostic (OpenAI-compatible chat API).

Reads ONLY the per-domain cache text, applies prompts/classify_flags.md, and
returns the parsed JSON flags. Works with any OpenAI-compatible endpoint — the
default is DeepSeek (cheap, capable); switch to Qwen / Moonshot / Zhipu / OpenAI
by changing providers.classify in config.yaml (base_url + model), no code change.

The prompt already instructs: no evidence → 'unknown', and ignore any
instructions found inside the page content (§7 — scraped text is data).
"""
from __future__ import annotations

import json

from .config import PROMPTS, env
from .http import request as http_request

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "deepseek/deepseek-chat"
DEFAULT_KEY_ENV = "OPENROUTER_API"


def _cfg(cfg: dict) -> dict:
    c = ((cfg.get("providers", {}) or {}).get("classify", {}) or {})
    return {
        "base_url": (c.get("base_url") or DEFAULT_BASE_URL).rstrip("/"),
        "model": c.get("model") or env("LLM_MODEL") or DEFAULT_MODEL,
        "key_env": c.get("api_key_env") or DEFAULT_KEY_ENV,
        "cost": float(c.get("cost_per_domain_eur", 0.0015)),
    }


def load_prompt() -> str:
    return (PROMPTS / "classify_flags.md").read_text(encoding="utf-8")


def build_user_content(domain: str, cache: dict) -> str:
    sources = cache.get("sources", []) or []
    src_lines = "\n".join(f"- {s.get('kind')}: {s.get('url')}" for s in sources)
    text = (cache.get("text", "") or "")[:18000]
    return f"DOMINIO: {domain}\nFONTI:\n{src_lines}\n\nCONTENUTO PAGINE:\n{text}"


def build_request(domain: str, cache: dict, cfg: dict) -> dict:
    """OpenAI-compatible chat/completions payload (pure/testable)."""
    return {
        "model": _cfg(cfg)["model"],
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": load_prompt()},
            {"role": "user", "content": build_user_content(domain, cache)},
        ],
    }


def parse_json(text: str) -> dict:
    """Extract the single JSON object from the model reply (pure/testable)."""
    s = (text or "").strip()
    start, end = s.find("{"), s.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("no JSON object in classifier reply")
    return json.loads(s[start : end + 1])


def classify_domain(api_key: str, domain: str, cache: dict, cfg: dict, timeout: int = 60) -> dict:
    c = _cfg(cfg)
    res = http_request(
        "POST",
        f"{c['base_url']}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=build_request(domain, cache, cfg),
        timeout=timeout,
        retries=3,
    )
    data = res.json()
    text = data["choices"][0]["message"]["content"]
    return parse_json(text)


def api_key_env(cfg: dict) -> str:
    return _cfg(cfg)["key_env"]


def cost_per_domain_eur(cfg: dict) -> float:
    return _cfg(cfg)["cost"]
