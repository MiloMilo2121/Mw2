from datetime import datetime, timezone

from lib.flags_det import invenduto_ratio, median_price, zona_from_state


def test_median_price_ignores_missing_and_zero():
    annunci = [{"prezzo": 100000}, {"prezzo": 200000}, {"prezzo": 0}, {"prezzo": None}, {}]
    assert median_price(annunci) == 150000.0
    assert median_price([]) is None


def test_invenduto_ratio_uses_fixed_now():
    now = datetime(2026, 7, 20, tzinfo=timezone.utc)
    annunci = [
        {"data_pubblicazione": "2026-01-01"},  # ~200 days → old
        {"data_pubblicazione": "2026-07-01"},  # ~19 days → fresh
        {"data_pubblicazione": None},           # undated → ignored
    ]
    assert invenduto_ratio(annunci, now=now, days=120) == 0.5
    assert invenduto_ratio([{"data_pubblicazione": None}], now=now) is None


def test_zona_from_state():
    assert zona_from_state("Lombardy") == "lombardia"
    assert zona_from_state("Veneto") == "veneto_triveneto"
    assert zona_from_state("Emilia-Romagna") == "emilia"
    assert zona_from_state("Sicily") == ""
