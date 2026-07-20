# Cestini pipeline — on-demand (NON gira su Vercel cron).
# I nomi dei file iniziano con una cifra: si eseguono come script, non moduli.

PY := python3

.PHONY: run dry-run ingest enrich classify qa test install

install: ; $(PY) -m pip install -r requirements.txt

# Vertical slice attuale: ingest -> enrich -> classify. 40/50/60 arrivano dopo la
# verifica dei flag su ~20 domini (vedi CLAUDE.md · ordine di costruzione).
run: ; $(PY) src/10_ingest.py && $(PY) src/20_enrich.py && $(PY) src/30_classify.py

# Stima chiamate e costo senza spendere né scrivere su Supabase.
dry-run: ; $(PY) src/10_ingest.py --dry-run && $(PY) src/20_enrich.py --dry-run && $(PY) src/30_classify.py --dry-run

ingest:   ; $(PY) src/10_ingest.py $(ARGS)
enrich:   ; $(PY) src/20_enrich.py $(ARGS)
classify: ; $(PY) src/30_classify.py $(ARGS)
qa:       ; $(PY) src/50_qa.py --recompute

test: ; $(PY) -m pytest -q
