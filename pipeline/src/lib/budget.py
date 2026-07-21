"""Budget guard — a hard cap per run (BUDGET_EUR_MAX).

Exceeding the cap stops the run cleanly (raises) rather than spending past it
or silently finishing partial (root CLAUDE.md §6). Charges are tracked per
provider so run_log / pipeline_runs can report where the money went.
"""
from __future__ import annotations

import threading


class BudgetExceeded(Exception):
    pass


class BudgetGuard:
    """Thread-safe: charge/would_exceed are safe to call from a worker pool."""

    def __init__(self, cap_eur: float) -> None:
        self.cap = float(cap_eur)
        self.spent = 0.0
        self.by_provider: dict[str, float] = {}
        self._lock = threading.Lock()

    def would_exceed(self, cost: float) -> bool:
        with self._lock:
            return self.spent + cost > self.cap + 1e-9

    def charge(self, provider: str, cost: float) -> float:
        """Record `cost` against `provider`. Raises before overspending."""
        with self._lock:
            if self.spent + cost > self.cap + 1e-9:
                raise BudgetExceeded(
                    f"budget {self.cap:.2f}€ exceeded: spent {self.spent:.3f}€ "
                    f"+ {cost:.3f}€ for {provider}"
                )
            self.spent += cost
            self.by_provider[provider] = self.by_provider.get(provider, 0.0) + cost
            return self.spent

    def affordable(self, unit_cost: float) -> int:
        """How many more units of `unit_cost` fit in the remaining budget."""
        if unit_cost <= 0:
            return 10**9
        with self._lock:
            return max(0, int((self.cap - self.spent + 1e-9) / unit_cost))

    @property
    def remaining(self) -> float:
        return max(0.0, self.cap - self.spent)

    @property
    def providers_used(self) -> list[str]:
        return sorted(self.by_provider)
