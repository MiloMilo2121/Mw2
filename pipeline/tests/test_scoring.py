from lib.scoring import (
    assign_cestino,
    error_rate,
    flags_to_dict,
    is_cestino_approved,
    qa_gate,
    resolve_sequence,
)


def test_assign_cestino_tree():
    assert assign_cestino({"open_house": "si", "struttura": "indipendente"})[0] == "A"
    assert assign_cestino({"struttura": "indipendente", "fascia_prezzo": "200000"})[0] == "B"
    assert assign_cestino({"struttura": "indipendente", "fascia_prezzo": "90000"})[0] == "C"
    assert assign_cestino({"struttura": "mini_franchising"})[0] == "D"
    assert assign_cestino({"struttura": "multi_sede_piccola"})[0] == "D"
    assert assign_cestino({"struttura": "indipendente"})[0] == "E"   # fascia unknown → E
    assert assign_cestino({})[0] == "E"


def test_flags_to_dict_prefers_flag_then_seed():
    rows = [{"tipo": "open_house", "valore": "no"}, {"tipo": "struttura", "valore": ""}]
    d = flags_to_dict(rows, seed={"struttura": "indipendente", "zona": "lombardia"})
    assert d["open_house"] == "no"
    assert d["struttura"] == "indipendente"  # seed fills the empty flag
    assert d["zona"] == "lombardia"


def test_resolve_sequence_fallback_and_per_zona():
    sequences = {
        "zone_prova": {"lombardia": "2A_caso_cardano"},
        "cestini": {
            "B": {
                "tono": "da_feedback",
                "step": [
                    {"slot": "gancio", "email": "1A_invenduto", "fallback": ["1B_primo_acquirente"]},
                    {"slot": "prova", "email": "per_zona"},
                    {"slot": "provvigione", "email": "6A_extra_provvigione", "fallback": ["6B_sconto"]},
                ],
            }
        },
    }
    feedback = {"email": {
        "1A_invenduto": "scartato",          # → fallback
        "1B_primo_acquirente": "approvato",
        "2A_caso_cardano": "approvato",
        "6A_extra_provvigione": {"stato": "giallo"},  # giallo → skip
        "6B_sconto": "approvato",
    }}
    r = resolve_sequence("B", "lombardia", sequences, feedback)
    emails = [e["email"] for e in r["emails"]]
    assert emails == ["1B_primo_acquirente", "2A_caso_cardano", "6B_sconto"]
    assert r["gaps"] == []


def test_resolve_sequence_records_gap_when_no_approved():
    sequences = {"cestini": {"E": {"tono": "istituzionale_sempre",
                                    "step": [{"slot": "gancio", "email": "x", "fallback": ["y"]}]}}}
    feedback = {"email": {"x": "scartato", "y": "scartato"}}
    r = resolve_sequence("E", "", sequences, feedback)
    assert r["emails"][0]["email"] is None
    assert r["gaps"] == ["gancio"]
    assert r["tono"] == "istituzionale"


def test_qa_gate_and_error_rate():
    assert error_rate([1, 1, 0, 1]) == 0.25
    assert error_rate([]) == 0.0
    assert qa_gate(0.10, 0.10) is True
    assert qa_gate(0.11, 0.10) is False


def test_is_cestino_approved_gate():
    approved = {"struttura": True, "fascia_prezzo": False, "open_house": True}
    assert is_cestino_approved("A", approved) is True          # open_house+struttura ok
    assert is_cestino_approved("B", approved) is False         # fascia failed
    assert is_cestino_approved("E", approved) is True          # no driving flags
    # Not-yet-measured driving flag blocks under require_qa, passes when skipped:
    assert is_cestino_approved("D", {}, require_qa=True) is False
    assert is_cestino_approved("D", {}, require_qa=False) is True
