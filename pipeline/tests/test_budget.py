import pytest

from lib.budget import BudgetExceeded, BudgetGuard


def test_charge_accumulates_and_tracks_providers():
    g = BudgetGuard(1.0)
    g.charge("apify", 0.3)
    g.charge("apify", 0.2)
    g.charge("classify", 0.1)
    assert round(g.spent, 3) == 0.6
    assert round(g.remaining, 3) == 0.4
    assert g.by_provider["apify"] == pytest.approx(0.5)
    assert g.providers_used == ["apify", "classify"]


def test_charge_raises_before_overspending():
    g = BudgetGuard(0.5)
    g.charge("apify", 0.4)
    assert g.would_exceed(0.2) is True
    with pytest.raises(BudgetExceeded):
        g.charge("apify", 0.2)
    assert round(g.spent, 3) == 0.4  # rejected charge not applied
