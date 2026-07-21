"""Config + paths + the §5 isolation guardrail.

Loads config.yaml and (optionally) a local .env, and exposes the pipeline's
directory layout. `assert_no_instantly()` turns the "the pipeline never holds
the Instantly key" rule (root CLAUDE.md §5) into a runtime check every script
runs at startup — the isolation is enforced, not merely documented.
"""
from __future__ import annotations

import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]   # .../pipeline
SRC = ROOT / "src"
DATA = ROOT / "data"
DATA_IN = DATA / "in"
DATA_OUT = DATA / "out"
DATA_CACHE = DATA / "cache"
QA_DIR = ROOT / "qa"
PROMPTS = ROOT / "prompts"

GUARD_KEY = "INSTANTLY_API_KEY"


def _load_dotenv() -> None:
    """Minimal .env loader (no python-dotenv dep). Never overrides real env."""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip())


_load_dotenv()


def assert_no_instantly(environ: dict | None = None) -> None:
    """Abort if the Instantly key is present in this process (§5 isolation)."""
    env = environ if environ is not None else os.environ
    if env.get(GUARD_KEY):
        raise SystemExit(
            f"GUARDRAIL VIOLATION: {GUARD_KEY} is set in the pipeline environment. "
            "The cestini pipeline must never hold it (root CLAUDE.md §5). "
            "Remove it from pipeline/.env and the shell before running."
        )


def load_config() -> dict:
    with open(ROOT / "config.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def env(name: str, default: str | None = None) -> str | None:
    val = os.environ.get(name)
    return val if val not in (None, "") else default


def client_slug() -> str:
    return env("CLIENT_SLUG", "geriko") or "geriko"


def budget_cap_eur() -> float:
    # Cap PER STAGE (ingest/enrich/classify each instantiate their own guard).
    # Enrich is the driver: ~domains × apify.cost_per_domain_eur. Default sized
    # for the email-only run (~2.5k × €0.02 ≈ €51).
    try:
        return float(env("BUDGET_EUR_MAX", "60") or 60)
    except ValueError:
        return 60.0
