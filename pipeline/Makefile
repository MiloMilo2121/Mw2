# Cestini pipeline — on-demand (NON gira su Vercel cron).
# I nomi dei file iniziano con una cifra: si eseguono come script, non moduli.

PY := python3

.PHONY: run dry-run ingest enrich classify qa test install

install: ; $(PY) -m pip install -r requirements.txt

# Catena completa: ingest -> enrich -> classify -> score -> qa(sample) -> export.
# NB: l'export applica il gate QA; è "finito" solo dopo `make qa` (recompute) su
# qa/sample.csv verificato a mano (Regola Zero).
run: ; $(PY) src/10_ingest.py && $(PY) src/20_enrich.py && $(PY) src/30_classify.py && \
	$(PY) src/40_score.py && $(PY) src/50_qa.py && $(PY) src/60_export.py

# Stima chiamate e costo senza spendere né scrivere su Supabase.
dry-run: ; $(PY) src/10_ingest.py --dry-run && $(PY) src/20_enrich.py --dry-run && $(PY) src/30_classify.py --dry-run

# Produce solo cestini + priorità (dopo enrich/classify).
cestini: ; $(PY) src/40_score.py && $(PY) src/60_export.py $(ARGS)

ingest:   ; $(PY) src/10_ingest.py $(ARGS)
enrich:   ; $(PY) src/20_enrich.py $(ARGS)
classify: ; $(PY) src/30_classify.py $(ARGS)
score:    ; $(PY) src/40_score.py $(ARGS)
export:   ; $(PY) src/60_export.py $(ARGS)
qa:       ; $(PY) src/50_qa.py --recompute

test: ; $(PY) -m pytest -q
