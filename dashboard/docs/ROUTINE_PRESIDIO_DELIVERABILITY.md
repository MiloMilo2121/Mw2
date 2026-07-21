# Routine — Presidio deliverability Geriko (giornaliero)

> Configurazione completa della Routine automatica che monitora la reputazione
> d'invio di Geriko (metodogeriko.it). Sola lettura: osserva, diagnostica,
> riporta. NON invia, NON cambia stato di campagne/account.

---

## 1 · Metadati della Routine

| Campo | Valore |
|---|---|
| **Nome** | `MW2 · Presidio deliverability Geriko (giornaliero)` |
| **Trigger ID** | `trig_016HGiASiwS53QA1jU8ANkLL` (già creato, attivo) |
| **Cron** | `0 7 * * *` |
| **Fuso** | il cron è in **UTC** → 07:00 UTC ≈ **09:00 Italia (CEST)** |
| **Frequenza** | ogni giorno |
| **Sessione** | `create_new_session_on_fire = true` (ogni run è una sessione pulita) |
| **Notifiche** | `push = true`, `email = true` |
| **Enabled** | `true` |
| **Environment** | `env_01MJ2gQ37g3ywzZ8sK6C2E99` |

## 2 · Dipendenza obbligatoria (env)

La sessione schedulata gira **senza il connettore MCP Instantly** (i cron non ricevono i connettori). Legge quindi via **API REST v2** e richiede la variabile d'ambiente:

| Nome | Valore |
|---|---|
| `Instantly_AXEND` | API key del workspace **Axend** di Instantly (usata come `Authorization: Bearer <key>`) |

Senza questa env, il report esce con "non ho accesso ai dati".

## 3 · Prompt della Routine (verbatim)

Questo è il testo esatto che parte a ogni run:

```
Sei l'agente Claude Code di MW2 (dashboard + automazioni Instantly di AXEND). Questa è una sessione AUTOMATICA schedulata: esegui il PRESIDIO DELIVERABILITY GIORNALIERO del cliente Geriko (dominio metodogeriko.it) e sorveglia la RAMPA SOFT di riattivazione.

PRIMA REGOLA — leggi `CLAUDE.md` nella root del repo e rispetta i guardrail. NON negoziabili:
- MAI attivare/mettere in pausa/modificare lo stato o i VOLUMI (daily_limit) di campagne o account. MAI inviare email. Sei in SOLA LETTURA: osservi, diagnostichi, riporti, PROPONI. Le azioni (riattivazioni, cambi di volume, pause) le esegue Marco a mano. Se un dato manca: "Non ho dati sufficienti su X" — non inventare.

CONTESTO: dal 15/07/2026 la reputazione d'invio è crollata (aperture reali ~67%→~19%→0% su GENERIC), con bounce elevati coerenti col blocco Google 5.7.1 "Policy blocked" (rifiuto per REPUTAZIONE, non indirizzi errati). Causa diagnosticata: over-sending su 3 caselle giovani/non pienamente scaldate — e.sassi@ (creata 25/06), emanuele.sassi@ (20/04), rosa.carretta@ (20/04); limiti nominali 30/30/20. Autenticazione dominio (SPF/DKIM/DMARC/MX Google) è CORRETTA, non è un problema di config. Il 21/07 Marco ha RIATTIVATO MANUALMENTE le 2 campagne Sassi di acquisizione (CON NOME 1dba8a9a, GENERIC 070607dd, status -2 → 1). Policy decisa da Marco: NON pausa, ma RAMPA SOFT — volumi bassi ora, aumento graduale SOLO se la reputazione regge; step-down immediato se peggiora. Tu monitori recupero e rampa, ogni giorno.

STRUMENTI: usa la MCP `Instantly_Axend`. Se non disponibile in sessione headless, usa l'API REST v2 (base https://api.instantly.ai/api/v2) con la chiave nell'env `Instantly_AXEND` e header `Authorization: Bearer $Instantly_AXEND`. Se non hai né MCP né chiave, dillo nel report e fermati.

COMPITO OGGI:
1. SALUTE CASELLE metodogeriko (GET /accounts): per e.sassi@, emanuele.sassi@, rosa.carretta@metodogeriko.it → status, warmup_status, stat_warmup_score, daily_limit. 🔴 se status ≤ 0.
2. APERTURE/INVII ultimi 3 giorni sulle campagne Geriko (GET /campaigns/analytics/daily per campagna): per ogni giorno con inviate>0 calcola open_unici/inviate. Soglie: 🔴 <20%, 🟡 20–35%, 🟢 >35%. Escludi dal gate i giorni con invii "freschi" di oggi (aperture non ancora accumulate).
3. BOUNCE ultime 24h: cerca nuovi hard bounce / codice 5.7.1 / "policy blocked" e calcola il bounce-rate per campagna (bounced/inviate). 🔴 se compare un 5.7.1 o se il rate > 5%.
4. STATO CAMPAGNE Geriko (le 7, scope: account metodogeriko o nome "geriko"): 🔴 se una torna in status negativo (-1/-2/-3).
5. RAMPA SOFT (le 2 Sassi riattivate da Marco il 21/07; ladder in doc §4):
   a. Leggi i NUOVI invii/giorno per campagna (new_leads_contacted) e per casella (GET /accounts/analytics/daily, oppure somma i daily delle campagne) delle ultime 72h.
   b. Confronta col LIVELLO LADDER corrente e segnala ogni campagna/casella che SUPERA il cap del livello.
   c. Colore del giorno: 🟢 = open reali > 35% AND bounce < 5% AND nessun 5.7.1 AND nessuna campagna in status negativo.
   d. Raccomanda la mossa a Marco CON I NUMERI: STEP-UP al livello successivo se 3 giorni 🟢 consecutivi; HOLD se misto; STEP-DOWN (e GENERIC Sassi → 0 nuovi) al primo giorno 🔴. GENERIC Sassi parte dal livello più basso e scende per prima (storico 0% aperture).

VERDETTO (report in italiano, denso, con numeri):
- Semaforo complessivo 🟢/🟡/🔴 + cosa è cambiato rispetto a ieri.
- Tabella: caselle (status/warmup/score), aperture per giorno, bounce nuovi + rate, stato campagne, LIVELLO RAMPA corrente + volumi effettivi vs cap.
- Raccomandazione operativa per Marco (tu proponi, lui esegue a mano): mossa rampa (step-up/hold/step-down) con i daily_limit esatti per campagna/casella.
- DESTINATARIO: recapita il verdetto a Marco tramite le notifiche della Routine (push + email). Quando esisterà `notify.ts`/env `ALERT_RECIPIENT`, usa quel destinatario configurabile. Un alert senza destinatario esplicito NON è accettabile.

NON eseguire alcuna azione su Instantly oltre la lettura.
```

## 4 · Riferimenti tecnici (per la sessione)

- 3 caselle: `e.sassi@`, `emanuele.sassi@`, `rosa.carretta@metodogeriko.it`.
- 7 campagne Geriko (ID): CON NOME Sassi `1dba8a9a…`, GENERIC Sassi `070607dd…`, Sassi v1 `e98d3fe7…`, Carretta `0b4a01cc…`, GENERIC Sassi copy `f230572e…`, GENERIC Rosa4 `b4d3fda9…`, CON NOME Rosa4 `a69e6b45…`.
- Endpoint utili (REST v2, Bearer): `/accounts?limit=100`, `/campaigns?limit=100`, `/campaigns/analytics/daily?campaign_id=…&start_date=…&end_date=…`.
- Soglia gate reputazione: aperture reali < 20% su un giorno con invii → 🔴.
- Nota: `stat_warmup_score` alto (~100) è il warmup INTERNO, NON la reputazione reale — validare sempre con le aperture reali.
- daily_limit attuali (rif.): campagne CON NOME Sassi 15, GENERIC Sassi 15; caselle e.sassi@ 30, emanuele.sassi@ 30, rosa.carretta@ 20.

## 4bis · Ladder rampa soft (post-riattivazione 21/07)

Nuovi invii/giorno per campagna. Si SALE di un livello solo dopo **3 giorni 🟢 consecutivi**; si SCENDE al **primo giorno 🔴**. Esecuzione = Marco (la Routine propone i numeri, non li applica).

| Livello | CON NOME Sassi | CON NOME Rosa 4 | GENERIC Sassi | Quando |
|---|---|---|---|---|
| **L0** (start, reputazione 🔴) | 5/g | 5/g | 3/g | punto di partenza post-riattivazione |
| **L1** | 8/g | 8/g | 5/g | dopo 3 gg 🟢 |
| **L2** | 12/g | 12/g | 8/g | dopo altri 3 gg 🟢 |
| **L3** (regime) | 15/g | 15/g | 15/g | 🟢 stabile ≥ 1 settimana |

- **Gate giorno 🟢**: open reali > 35% AND bounce < 5% AND nessun 5.7.1 AND nessuna campagna in status negativo.
- **STEP-DOWN**: un solo giorno 🔴 (open < 20% OR bounce > 5% OR un 5.7.1 OR status negativo) → −1 livello **e GENERIC Sassi → 0 nuovi**; resta finché non torni 🟢 per 2 giorni.
- **GENERIC Sassi** parte più basso e scende per prima: storico 0% aperture reali su 42 invii = canale in spam, il più a rischio di ri-innescare il 5.7.1.
- **`daily_limit` è PER CASELLA di invio**, non totale campagna. Le due Sassi (CON NOME + GENERIC) condividono le stesse 2 caselle `e.sassi@`+`emanuele.sassi@`; Rosa 4 usa solo `rosa.carretta@`. Quindi a L0 il carico effettivo ≈ CN Sassi 10/g + GENERIC 6/g (su 2 caselle) + Rosa 4 5/g. Vincolo: la somma per casella (campagne + warmup) non deve superare il daily_limit nominale della casella (30/30/20).

### Audit — cambi volume applicati
- **21/07/2026 16:47 UTC · L0 applicato** (esecutore: Claude via MCP `update_campaign`, su ok esplicito di Marco in chat). daily_limit: CON NOME Sassi **15→5**, CON NOME Rosa 4 **20→5**, GENERIC Sassi **15→3**. Motivo: rampa soft post-riattivazione, reputazione ancora compromessa (GENERIC 0% aperture, bounce 19–43%). **Rollback:** rimettere daily_limit 15 / 20 / 15 sulle rispettive campagne.

## 5 · Come rilanciare / ricreare la Routine

- **Già attiva**: il trigger `trig_016HGiASiwS53QA1jU8ANkLL` è persistente lato server e parte da solo ogni giorno alle 07:00 UTC — non serve una sessione aperta.
- **Per eseguirla a mano in una sessione nuova**: incollare il prompt della §3 in una sessione Claude Code (che abbia la env `Instantly_AXEND`).
- **Per ricrearla da zero**: usare la UI Routines di claude.ai, oppure il tool `create_trigger` con i parametri della §1 e il prompt della §3.

## 6 · Stato al 21/07/2026 (ultimo run manuale)

🟡→🔴. Caselle **tutte status 1 (sbloccate da Marco)**, warmup on, score 100 (interno). **Le 2 campagne Sassi acquisizione sono state RIATTIVATE MANUALMENTE da Marco il 21/07 alle 15:49 UTC** (status -2 → 1) — riattivazione confermata da Marco, evento reale (verificato: `timestamp_updated` odierno), non anomalia API. Reputazione NON ancora recuperata: **GENERIC Sassi 0% aperture reali su 42 invii** (spam pieno), CON NOME 14–33%, **bounce elevati** (GENERIC Sassi ≈43%, CON NOME Rosa4 ≈19%). CON NOME Rosa4 ha ripreso a inviare (9 il 21/07). **Decisione operativa di Marco: NON pausa → RAMPA SOFT** (vedi §4bis): partenza da **L0** (CON NOME 5/g, Rosa4 5/g, GENERIC 3/g), salita di un livello solo dopo 3 giorni 🟢, step-down al primo 🔴 (GENERIC prima). La Routine sorveglia il gate ogni mattina e propone la mossa; i cambi di daily_limit li applica Marco a mano.

### Storico run
- **20/07** 🔴 — 2 Sassi in status -2 (errore); GENERIC 0% aperture su 40+ invii; invii fermi dal 18/07. Verdetto: non riprendere.
