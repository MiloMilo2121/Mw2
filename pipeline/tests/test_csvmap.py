from lib.csvmap import map_row, nome_seed, struttura_seed

MAPPING = {
    "domain": "Company Website Short",
    "company": "Cleaned Company Name",
    "first_name": "First Name",
    "email": "Email",
    "employees": "Employee Count",
    "city": "Company City",
}


def test_map_row_normalizes_domain_and_reads_extras():
    row = {
        "Company Website Short": "www.Rossi.it",
        "Cleaned Company Name": "Rossi Immobili",
        "Email": "info@rossi.it",
        "Employee Count": "3",
        "Company City": "Como",
        "Company State": "Lombardy",
        "Title": "Titolare",
        "Number of Retail Locations": "1",
    }
    m = map_row(row, MAPPING)
    assert m["dominio"] == "rossi.it"
    assert m["company"] == "Rossi Immobili"
    assert m["state"] == "Lombardy"
    assert m["title"] == "Titolare"


def test_struttura_seed_thresholds():
    assert struttura_seed("3", "5") == "mini_franchising"   # locations wins
    assert struttura_seed("3", "2") == "multi_sede_piccola"
    assert struttura_seed("4", "") == "indipendente"        # small headcount
    assert struttura_seed("40", "") == ""                   # unknown


def test_nome_seed_only_si_or_empty():
    assert nome_seed("Titolare", "Owner") == "si"
    assert nome_seed("Agente", "") == ""
