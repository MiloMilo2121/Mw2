from lib.providers.scrape_direct import html_to_text
from lib.scoring import is_not_agency


def test_html_to_text_strips_tags_scripts_and_collapses():
    html = """<html><head><style>.x{color:red}</style><script>var a=1</script></head>
      <body><h1>Agenzia  Rossi</h1><p>Immobili in  vendita</p></body></html>"""
    t = html_to_text(html)
    assert "Agenzia Rossi" in t
    assert "Immobili in vendita" in t
    assert "color:red" not in t and "var a" not in t  # script/style dropped
    assert "<" not in t and ">" not in t


def test_html_to_text_caps_length():
    assert len(html_to_text("<p>" + "x" * 5000 + "</p>", cap=100)) == 100


def test_html_to_text_empty():
    assert html_to_text("") == ""
    assert html_to_text(None) == ""


def test_is_not_agency_excludes_only_on_explicit_no():
    assert is_not_agency({"is_agency": "no"}) is True
    assert is_not_agency({"is_agency": "si"}) is False
    assert is_not_agency({"is_agency": "unknown"}) is False   # uncertainty → keep
    assert is_not_agency({}) is False                          # absence → keep
