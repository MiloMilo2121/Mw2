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
Sei l'agente Claude Code di MW2 (dashboard + automazioni Instantly di AXEND). Questa è una sessione AUTOMATICA schedulata: esegui il PRESIDIO DELIVERABILITY GIORNALIERO del cliente Geriko (dominio metodogeriko.it).

PRIMA REGOLA — leggi `CLAUDE.md` nella root del repo e rispetta i guardrail. NON negoziabili:
- MAI attivare/mettere in pausa/modificare lo stato di campagne o account. MAI inviare email. Sei in SOLA LETTURA: osservi, diagnostichi, riporti. Le azioni le esegue Marco. Se un dato manca: "Non ho dati sufficienti su X" — non inventare.

CONTESTO: dal 15/07/2026 la reputazione d'invio è crollata (aperture ~67%→~19%), poi sono arrivati bounce 5.7.1 "Policy blocked" (Google rifiuta per REPUTAZIONE, non indirizzi errati) e invii a 0. Causa diagnosticata: over-sending su 3 caselle giovani/non pienamente scaldate — e.sassi@ (creata 25/06), emanuele.sassi@ (20/04), rosa.carretta@ (20/04); limiti 30/30/20 ≈ 80/g. Autenticazione dominio (SPF/DKIM/DMARC/MX Google) è CORRETTA, quindi non è un problema di config. Fix in corso: warmup + rampa soft di riavvio (la decide/esegue Marco). Tu monitori il recupero, ogni giorno.

STRUMENTI: usa la MCP `Instantly_Axend`. Se non disponibile in sessione headless, usa l'API REST v2 (base https://api.instantly.ai/api/v2) con la chiave nell'env `Instantly_AXEND` e header `Authorization: Bearer $Instantly_AXEND`. Se non hai né MCP né chiave, dillo nel report e fermati.

COMPITO OGGI:
1. SALUTE CASELLE metodogeriko (GET /accounts): per e.sassi@, emanuele.sassi@, rosa.carretta@metodogeriko.it → status, warmup_status, stat_warmup_score, daily_limit. 🔴 se status ≤ 0.
2. APERTURE/INVII ultimi 3 giorni sulle campagne Geriko (GET /campaigns/analytics/daily per campagna): per ogni giorno con inviate>0 calcola open_unici/inviate. Soglie: 🔴 <20%, 🟡 20–35%, 🟢 >35%.
3. BOUNCE ultime 24h: cerca nuovi hard bounce / codice 5.7.1 / "policy blocked". 🔴 se ne compare anche uno solo.
4. STATO CAMPAGNE Geriko (le 7, scope: account metodogeriko o nome "geriko"): 🔴 se una è in status negativo (-1/-2/-3).

VERDETTO (report in italiano, denso, con numeri):
- Semaforo complessivo 🟢/🟡/🔴 + cosa è cambiato rispetto a ieri.
- Tabella: caselle (status/warmup/score), aperture per giorno, bounce nuovi, stato campagne.
- Raccomandazione operativa per Marco: 🟢 stabile da più giorni → può procedere/salire nella rampa soft; 🟡 → tenere fermo il volume; 🔴 → NON riprendere / fermare, reputazione ancora compromessa. Ricorda sempre che l'esecuzione è di Marco, tu proponi.

NON eseguire alcuna azione su Instantly oltre la lettura.
```

## 4 · Riferimenti tecnici (per la sessione)

- 3 caselle: `e.sassi@`, `emanuele.sassi@`, `rosa.carretta@metodogeriko.it`.
- 7 campagne Geriko (ID): CON NOME Sassi `1dba8a9a…`, GENERIC Sassi `070607dd…`, Sassi v1 `e98d3fe7…`, Carretta `0b4a01cc…`, GENERIC Sassi copy `f230572e…`, GENERIC Rosa4 `b4d3fda9…`, CON NOME Rosa4 `a69e6b45…`.
- Endpoint utili (REST v2, Bearer): `/accounts?limit=100`, `/campaigns?limit=100`, `/campaigns/analytics/daily?campaign_id=…&start_date=…&end_date=…`.
- Soglia gate reputazione: aperture reali < 20% su un giorno con invii → 🔴.
- Nota: `stat_warmup_score` alto (~100) è il warmup INTERNO, NON la reputazione reale — validare sempre con le aperture reali.

## 5 · Come rilanciare / ricreare la Routine

- **Già attiva**: il trigger `trig_016HGiASiwS53QA1jU8ANkLL` è persistente lato server e parte da solo ogni giorno alle 07:00 UTC — non serve una sessione aperta.
- **Per eseguirla a mano in una sessione nuova**: incollare il prompt della §3 in una sessione Claude Code (che abbia la env `Instantly_AXEND`).
- **Per ricrearla da zero**: usare la UI Routines di claude.ai, oppure il tool `create_trigger` con i parametri della §1 e il prompt della §3.

## 6 · Stato al 20/07/2026 (ultimo run manuale)

🔴 ROSSO. Caselle attive (warmup score 100 = interno). 2 campagne Sassi acquisizione ancora in **status -2 (errore)**. GENERIC Sassi a **0% aperture reali** su 40+ invii (spam pieno). Invii fermi dal 18/07. Verdetto: **non riprendere gli invii**; warmup + rampa soft da CON NOME quando le aperture reali risalgono. Sblocco/riattivazione = Marco.
