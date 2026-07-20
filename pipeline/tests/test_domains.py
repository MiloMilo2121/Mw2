from lib.domains import dedup_by_domain, normalize_domain


def test_normalize_strips_scheme_www_path_case():
    assert normalize_domain("https://www.Rossi-Immobili.it/annunci") == "rossi-immobili.it"
    assert normalize_domain("HTTP://Case.example.IT:8080") == "case.example.it"
    assert normalize_domain("plainhost.it") == "plainhost.it"
    assert normalize_domain("") == ""


def test_dedup_keeps_first_and_drops_empty():
    rows = [
        {"dominio": "a.it", "n": 1},
        {"dominio": "a.it", "n": 2},
        {"dominio": "", "n": 3},
        {"dominio": "b.it", "n": 4},
    ]
    out = dedup_by_domain(rows)
    assert [r["dominio"] for r in out] == ["a.it", "b.it"]
    assert out[0]["n"] == 1  # first wins
