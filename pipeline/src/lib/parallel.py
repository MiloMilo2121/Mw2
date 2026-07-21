"""Bounded parallelism for the I/O-bound stages (enrich, classify).

Each item is independent and writes its own per-domain cache file, so a thread
pool is safe. Order is not preserved (irrelevant — results are keyed by domain).
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable


def run_pool(items: list, fn: Callable, workers: int) -> list:
    workers = max(1, int(workers))
    if workers == 1 or len(items) <= 1:
        return [fn(it) for it in items]
    out = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(fn, it) for it in items]
        for f in as_completed(futures):
            out.append(f.result())
    return out
