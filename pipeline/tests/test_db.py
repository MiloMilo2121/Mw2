from lib.db import align_rows


def test_align_rows_unions_keys_and_fills_none():
    rows = [
        {"lead_id": "1", "tipo": "zona", "valore": "veneto_triveneto", "provider": "csv_seed"},
        {"lead_id": "2", "tipo": "open_house", "valore": "si", "confidence": 0.9,
         "evidenza": "porte aperte", "source_url": "https://x.it", "provider": "llm"},
    ]
    out = align_rows(rows)
    # every row now has the SAME key set (the union)
    keys = {frozenset(r) for r in out}
    assert len(keys) == 1
    expected = {"lead_id", "tipo", "valore", "confidence", "evidenza", "source_url", "provider"}
    assert set(out[0]) == expected
    # missing keys filled with None, present values preserved
    assert out[0]["confidence"] is None
    assert out[0]["source_url"] is None
    assert out[0]["valore"] == "veneto_triveneto"
    assert out[1]["confidence"] == 0.9


def test_align_rows_noop_when_homogeneous():
    rows = [{"a": 1, "b": 2}, {"a": 3, "b": 4}]
    assert align_rows(rows) == rows


def test_align_rows_empty():
    assert align_rows([]) == []
