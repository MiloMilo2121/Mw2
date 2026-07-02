# Proof Engine — Project Memory

## Cosa stiamo facendo
Generare proof artifacts per-azienda per i target SF di Marco. Output = artefatto
funzionante + pagina di consegna + URL condivisibile. Obiettivo: ruolo founding
GTM / forward-deployed engineer. Metrica unica: artefatti spediti e online.

## Regole non negoziabili
- SHIP > PERFECT. Pilota end-to-end prima di scalare.
- NO framework/backend/DB/auth/multi-tenant per l'engine. Runtime = Claude Code.
- Codice congelato dopo G6: solo produzione artefatti.
- Ogni claim ha fonte. Dati mancanti → data_gaps. Mai allucinare.
- Un artefatto = un problema reale e specifico di QUELLA azienda. Se è generico, scarta.
- Output deliverable in inglese US. Istruzioni/chat in italiano.

## Voce
Marco: "Costruisco sistemi, non slide." Diretto, denso, zero hype, prova-di-competenza.
Mostra, non promettere.

## Design
Carica SEMPRE la skill `marco-milanello-design` prima di generare UI.
Space Grotesk + Inter; cream/terracotta/ink.
Token estratti / fallback locale: vedi `lib/design/tokens.json` e `lib/design/README.md`.

## Checkpoint umani (fermati e chiedi a Marco)
1. Selezione target. 2. Approvazione wedge. 3. Ok-to-deploy artefatto.
Tra un checkpoint e l'altro: autonomia piena, default ragionevoli, non sommergere
Marco di domande.

## Pipeline
domain → /research → dossier.json → /diagnose → diagnosis.md → /build → artifact/ (Vercel) → /deliver → one-pager + outreach + URL
`/proof <domain>` esegue tutto ma si ferma ai 3 checkpoint.

## Tooling
- Research: Exa, Firecrawl, Scrapfly, Bright Data, Tavily, Attio (CRM). Web search fallback.
- Deploy: Vercel MCP.
- Design: skill `marco-milanello-design`.
- AI dentro artefatti agentici: Anthropic API lato artefatto. MAI API key hardcoded.

## Stato
Target completati:
- **Sim (sim.ai)** — PILOTA ✅ end-to-end. Wedge: stargazer→enterprise pipeline.
  - Artefatto (live): https://raw.githack.com/MiloMilo2121/Mw2/claude/proof-engine-build-spec-c2ful2/proof-engine/targets/sim/artifact/index.html
  - One-pager (live): https://raw.githack.com/MiloMilo2121/Mw2/claude/proof-engine-build-spec-c2ful2/proof-engine/targets/sim/delivery/one-pager/index.html
  - Dati reali: 100 stargazer campionati, 29 con employer, 10 enterprise + 15 design-partner.
  - Hosting attuale = raw.githack.com (zero-infra, dal repo). Per outreach definitivo → deploy su Vercel sotto dominio Marco (serve token/login: non disponibile in questo ambiente). File pronti in artifact/ e delivery/one-pager/.
  - TODO umano pre-invio: verificare handle LinkedIn di Emir/Waleed; confermare che il ruolo Founding GTM sia ancora aperto.
