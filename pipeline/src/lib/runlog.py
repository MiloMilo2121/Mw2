"""Run log — every run writes data/out/run_log.json (when, how many, providers,
estimated cost), mirroring what pipeline_runs stores on Supabase (§6).
"""
from __future__ import annotations

import json

from .config import DATA_OUT


def write_run_log(payload: dict) -> None:
    DATA_OUT.mkdir(parents=True, exist_ok=True)
    (DATA_OUT / "run_log.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def merge_errors(stage: str, items: list[dict]) -> None:
    """Record per-domain failures for a stage into data/out/errors.json, so a
    run's failures are an explicit list — not just a count buried in run_log."""
    path = DATA_OUT / "errors.json"
    data: dict = {}
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            data = {}
    data[stage] = items
    DATA_OUT.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def append_stage(stage: str, info: dict) -> dict:
    """Merge a stage's summary into run_log.json and return the full log."""
    path = DATA_OUT / "run_log.json"
    log: dict = {}
    if path.exists():
        try:
            log = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            log = {}
    log.setdefault("stages", {})[stage] = info
    write_run_log(log)
    return log
