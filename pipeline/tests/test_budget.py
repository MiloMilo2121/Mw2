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


def test_affordable_units():
    g = BudgetGuard(1.0)
    assert g.affordable(0.02) == 50
    g.charge("x", 0.6)
    assert g.affordable(0.02) == 20
    assert g.affordable(0) >= 10**9  # free → unbounded


def test_thread_safe_never_overspends():
    import threading

    g = BudgetGuard(10.0)

    def worker():
        for _ in range(200):
            try:
                g.charge("x", 0.1)
            except BudgetExceeded:
                pass

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert g.spent <= 10.0 + 1e-9  # cap never breached under concurrency
