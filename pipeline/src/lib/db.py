"""Supabase writer (service role, REST). The ONLY external system the pipeline
writes to. In dry-run it touches no network: rows are buffered and dumped to
data/out/db_dryrun.json so a run can be inspected without a database.
"""
from __future__ import annotations

import json
import uuid

import requests

from .config import DATA_OUT, env


class SupabaseWriter:
    def __init__(self, dry_run: bool = False, timeout: int = 30) -> None:
        self.dry_run = dry_run
        self.timeout = timeout
        self.url = (env("SUPABASE_URL") or "").rstrip("/")
        self.key = env("SUPABASE_SERVICE_ROLE_KEY") or ""
        self._buffer: dict[str, list[dict]] = {}
        if not dry_run and not (self.url and self.key):
            raise SystemExit(
                "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — set them or use --dry-run."
            )

    def _headers(self) -> dict:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def insert(self, table: str, rows: list[dict]) -> list[dict]:
        """Insert rows; return them WITH ids (synthetic ids in dry-run)."""
        if not rows:
            return []
        if self.dry_run:
            stamped = [{"id": str(uuid.uuid4()), **r} for r in rows]
            self._buffer.setdefault(table, []).extend(stamped)
            return stamped
        res = requests.post(
            f"{self.url}/rest/v1/{table}",
            headers=self._headers(),
            data=json.dumps(rows),
            timeout=self.timeout,
        )
        res.raise_for_status()
        return res.json()

    def insert_one(self, table: str, row: dict) -> dict:
        out = self.insert(table, [row])
        return out[0] if out else {}

    def flush_dryrun(self) -> None:
        if not self.dry_run:
            return
        DATA_OUT.mkdir(parents=True, exist_ok=True)
        (DATA_OUT / "db_dryrun.json").write_text(
            json.dumps(self._buffer, ensure_ascii=False, indent=2), encoding="utf-8"
        )
