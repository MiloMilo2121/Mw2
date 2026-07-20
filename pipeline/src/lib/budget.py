"""Budget guard — a hard cap per run (BUDGET_EUR_MAX).

Exceeding the cap stops the run cleanly (raises) rather than spending past it
or silently finishing partial (root CLAUDE.md §6). Charges are tracked per
provider so run_log / pipeline_runs can report where the money went.
"""
from __future__ import annotations


class BudgetExceeded(Exception):
    pass


class BudgetGuard:
    def __init__(self, cap_eur: float) -> None:
        self.cap = float(cap_eur)
        self.spent = 0.0
        self.by_provider: dict[str, float] = {}

    def would_exceed(self, cost: float) -> bool:
        return self.spent + cost > self.cap + 1e-9

    def charge(self, provider: str, cost: float) -> float:
        """Record `cost` against `provider`. Raises before overspending."""
        if self.would_exceed(cost):
            raise BudgetExceeded(
                f"budget {self.cap:.2f}€ exceeded: spent {self.spent:.3f}€ "
                f"+ {cost:.3f}€ for {provider}"
            )
        self.spent += cost
        self.by_provider[provider] = self.by_provider.get(provider, 0.0) + cost
        return self.spent

    @property
    def remaining(self) -> float:
        return max(0.0, self.cap - self.spent)

    @property
    def providers_used(self) -> list[str]:
        return sorted(self.by_provider)
