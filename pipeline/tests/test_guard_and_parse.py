import pytest

from lib.classify import parse_json
from lib.config import assert_no_instantly
from lib.exclusions import excluded_by_brand


def test_assert_no_instantly_blocks_when_key_present():
    with pytest.raises(SystemExit):
        assert_no_instantly({"INSTANTLY_API_KEY": "leaked"})
    # absent → no raise
    assert_no_instantly({"APIFY_TOKEN": "x"})


def test_excluded_by_brand_matches_company_or_domain():
    brands = ["tecnocasa", "remax"]
    assert excluded_by_brand("Tecnocasa Milano", "tecnocasa-mi.it", brands) == "tecnocasa"
    assert excluded_by_brand("Rossi", "remax-como.it", brands) == "remax"
    assert excluded_by_brand("Rossi Immobili", "rossi.it", brands) is None


def test_parse_json_extracts_object_from_noisy_reply():
    reply = 'Ecco il risultato:\n{"open_house": {"value": "si"}}\nfine.'
    assert parse_json(reply) == {"open_house": {"value": "si"}}
    with pytest.raises(ValueError):
        parse_json("nessun json qui")
