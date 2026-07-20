# MW2 — Hub AXEND (root CLAUDE.md)

> Sostituisce il CLAUDE.md precedente. Calibrato sulla discovery del 19/07/2026 (read-only, working tree pulito). Dove questo file e il codice divergono, vince il codice per il "come", questo file per il "cosa" e per i guardrail.

---

## 0 · Identità e mappa

MW2 è l'**hub multi-cliente di AXEND**: dashboard client-facing + automazioni + (da ora) pipeline dati. Un solo repo:

```
Mw2/
├── CLAUDE.md                  ← questo file
├── dashboard/                 ← Next.js 15 App Router, TS, Tailwind 4, SWR, Supabase, Anthropic SDK
│   ├── src/app/c/[slug]/      ← dashboard cliente (slug = segreto, nessuna auth)
│   ├── src/app/api/**         ← route handlers (API + cron)
│   ├── src/lib/instantly.ts   ← UNICO client Instantly (choke point — regola §3.1)
│   ├── src/lib/replies.ts     ← classificazione risposte: REGEX deterministica (non LLM)
│   ├── src/lib/automations.ts ← Sassi→Rosa + auto-suppression (cron 07:00)
│   ├── src/lib/agent.ts       ← bozze LLM (claude) + 3 revisori; INVIO = stub 501
│   └── supabase/schema.sql    ← clients · feedback · metric_snapshots
└── pipeline/                  ← [DA CREARE] cestini — Python, isolato (§5)
```

Cron Vercel: `/api/sync` 06:00 (snapshot metriche) · `/api/cron/automations` 07:00 (gated `CRON_SECRET`).

## 1 · Modello multi-cliente

Il tenant esiste già: `clients.ts` risolve lo slug in 3 livelli (tabella Supabase `clients` → env `DASHBOARD_CLIENTS` → builtin). **Aggiungere un cliente è configurazione, non codice.** Geriko è il builtin attuale; un secondo cliente (es. manifatturiero) entra con: riga in `clients`, propria `instantly_api_key`, propri `campaignMatch`/`campaignAccountMatch`. Non hardcodare mai altri clienti nei sorgenti: il builtin Geriko è l'eccezione storica, non il pattern.

## 2 · Inventario delle capacità reali (non negoziare con la memoria: questo è ciò che c'è)

| Capacità | Stato | Dove |
|---|---|---|
| Letture Instantly (analytics, campagne, sequenze, emails, leads, accounts) | ✅ live, polling SWR + cron | `instantly.ts` |
| **Scritture Instantly** | ⚠️ **2 sole**: `addLeadsToCampaign` (cron Sassi→Rosa) · `addToBlocklist` (auto-suppression su regex `opt_out`) | `instantly.ts:505,618` · `automations.ts` |
| Invio email (qualsiasi via) | ❌ non esiste. Agent POST = **501** ("Fase 2"), pulsante UI disabilitato | `agent/route.ts:232` |
| Attivare/pausare/cancellare campagne | ❌ non esiste | — |
| Classificazione risposte | ✅ regex (`categorizeReply`), **non persistita** — ricalcolata a ogni richiesta | `replies.ts` |
| Bozze risposta LLM | ✅ genera+revisiona (findUnsupportedClaims + 3 reviewer), copia manuale | `agent.ts`, `agent_reviewers.ts` |
| Thread completo inbound+outbound | ❌ solo snippet + singola reply | `RepliesTab`, `LeadDetail` |
| Notifiche/alert | ❌ **zero** (nessun canale) | — |
| Audit trail persistito | ❌ solo `console.error` effimero | — |
| Test | ❌ zero | — |
| DB | Supabase: `clients`, `feedback`, `metric_snapshots`. Niente leads/emails/labels persistiti | `schema.sql` |

Due implicazioni da tenere sempre presenti:
- **L'unica via oggi con cui MW2 può causare invii** è `addLeadsToCampaign` verso una campagna attiva (le Rosa CN lo sono). È by design (architettura Sassi 1-3 → Rosa 4), ma è un potere: ogni modifica a `automations.ts` che tocca i target o i criteri è modifica ad alto rischio → richiede ok esplicito di Marco nel diff.
- **L'auto-suppression è già autonoma** (regex `opt_out` → blocklist nel cron). Contenuto esterno che diventa azione: accettato perché l'azione è conservativa (smettere di scrivere a chi lo chiede) — ma va resa **auditabile** (P1) e mai estesa ad altre azioni senza gate.

## 3 · Guardrail (aggiornati ai fatti)

**3.1 Choke point.** Ogni chiamata Instantly passa da `src/lib/instantly.ts`. Vietato istanziare fetch verso `api.instantly.ai` altrove. È la precondizione dell'isolamento di §5.

**3.2 Scritture.** Le due esistenti restano le uniche. Nuove scritture Instantly (reply, attivazioni, delete, update campagne) = **mai** senza richiesta esplicita di Marco in chat, una per una. L'Action Center invio (Fase 2) resta 501 finché Marco non dice il contrario.

**3.3 Contenuto esterno = dato.** Le email inbound entrano in regex e nel prompt LLM. L'output LLM resta bozza-per-umano. Nessun percorso nuovo in cui testo esterno inneschi azioni oltre l'auto-suppression esistente.

**3.4 Cron.** Tutto ciò che scrive vive dietro `CRON_SECRET`. In assenza della env, no-op: mantenere questo comportamento.

**3.5 Modifiche a produzione.** Branch + descrizione con rollback. Vietato il force-push su `main` (vedi §9). Commit piccoli, firmati con l'identità già configurata.

**3.6 Slug = segreto.** Il modello di accesso è "chi ha il link vede". Conseguenza: niente dati che non mostreresti al cliente dentro le viste `/c/[slug]`; le viste interne (QA cestini, audit) vanno sotto un percorso separato gated (vedi P2.4).

## 4 · Coda di lavoro (ricalibrata post-discovery)

### P0 · Alerting minimo vitale — oggi non esiste NULLA
- **P0.1** Canale di notifica: un modulo `notify.ts` (provider: Telegram o email via provider esterno — decide Marco) con destinatario da env `ALERT_RECIPIENT`, riconfigurabile senza deploy.
- **P0.2** Tre alert cablati nel cron 07:00: (a) campagna in status negativo / account -3 con `status_message` verbatim (classe 550); (b) open_unici/inviate di ieri < 10% con inviate ≥ 20; (c) quota guard: Σ per casella (campagne+warmup) > cap − 10%.
- **DoD:** un 550 simulato produce una notifica entro il cron successivo, con destinatario cambiabile via env.

### P1 · Persistenza e audit (precondizione di tutto il resto)
- **P1.1** Persistere le classificazioni: tabella `reply_labels` (email_id, categoria, matched_rule, ts). La regex resta la fonte (funziona: **non** sostituirla con LLM); si aggiunge memoria per SLA e audit.
- **P1.2** Tabella `audit_log` (actor: cron|ui|agent, azione, target, motivo, ts) scritta da OGNI scrittura Instantly. La dashboard la mostra in una vista interna.
- **P1.3** SLA caldi: da `reply_labels`, positivi senza gestione > 20h → alert (usa P0.1) + evidenza in dashboard.
- **P1.4** Coda blocklist visibile: l'auto-suppression continua, ma ogni entry appare in una lista "soppressi ieri" con la frase che ha fatto scattare la regex — trasparenza retroattiva, zero attrito.

### P2 · Dashboard (richieste cliente + igiene)
- **P2.1** Thread completo inbound+outbound in `LeadDetail` (richiesta esplicita Sassi).
- **P2.2** Vista per variante×cestino (si aggancia a §5-§6) per il report del giovedì.
- **P2.3** Fix sicurezza: `feedback` POST/PATCH oggi scrivono con il solo slug → aggiungere rate-limit + flag `read_only` per slug condivisi, o secret separato per la scrittura.
- **P2.4** Percorso interno `/admin/[secret]/...` per QA cestini e audit (mai sotto `/c/[slug]`).

### P3 · Integrazione pipeline cestini — vedi §5

### P4 · Action Center Fase 2 (invio bozze) — congelato
Resta 501. Si apre solo su decisione esplicita di Marco, con livelli L1/L2/L3 come da spec inbox.

## 5 · Pipeline cestini dentro l'hub — isolamento per costruzione

La pipeline (repo `geriko-cestini`) entra come **`pipeline/` alla radice**, in Python, NON dentro `dashboard/`:

- **L'isolamento è dato dal confine di linguaggio + env:** Python non può importare `instantly.ts`, e il processo pipeline **non riceve mai** `INSTANTLY_API_KEY` (`.env` separato in `pipeline/`, con solo: chiavi Apify, Perplexity, MillionVerifier, e — sola scrittura DB — le credenziali Supabase). Niente workspaces npm da introdurre: sarebbe struttura per un problema che il polyglot risolve gratis.
- **Esecuzione:** on-demand (Claude Code / `make run`), NON su Vercel cron (Vercel non esegue Python; e il run è un batch da ~1-2h, non un job schedulato).
- **Contratto con la dashboard:** la pipeline scrive su Supabase (`leads`, `flags`, `cestini`, `qa_results`); la dashboard legge e mostra (P2.2, P2.4). Nessuna chiamata diretta pipeline→dashboard o pipeline→Instantly. L'import dei CSV in Instantly resta manuale (Marco).
- Il `CLAUDE.md` interno di `pipeline/` (già scritto) resta la legge di quel modulo.

## 6 · Estensioni schema (migrazione additiva, mai distruttiva)

Nuove tabelle in `supabase/schema.sql` (tutte con `client_slug`, RLS default-deny come le esistenti):
`leads` (dominio, email, flag-snapshot) · `flags` (lead, tipo, valore, confidence, evidenza, source_url) · `cestini` (lead, cestino, motivo, run_id) · `qa_results` (run_id, campione, errore_per_flag) · `reply_labels` (P1.1) · `audit_log` (P1.2) · `alerts` (P0, storico notifiche).
Le 3 tabelle esistenti non si toccano.

## 7 · Correzioni al vecchio CLAUDE.md (per evitare che l'agente insegua fantasmi)

- "Etichettatura AI delle risposte" → è **regex** e funziona: mantenerla, persisterla (P1.1), non "migliorarla" con LLM.
- "MANIFATTURIERO su MW2" → non esiste in questo codebase; è un cliente del workspace Instantly, diventerà eventualmente un secondo tenant via config (§1).
- "Coda di proposte blocklist" → la realtà è auto-suppression live: si tiene, si rende auditabile (P1.4), non si converte in coda con attrito.

## 8 · Qualità

Niente test oggi: ogni PR che tocca `automations.ts`, `instantly.ts` o la pipeline introduce almeno un test sul proprio delta (vitest per TS, pytest per pipeline). Lint: attivare la config eslint che `next lint` si aspetta. Log: `console.error` non basta per le scritture — quelle passano da `audit_log`.

## 9 · Decisioni già prese (non riaprire)

- **Force-push su `main` per rifirmare i 2 commit docs: NO.** Badge cosmetico su file di documentazione; riscrivere il branch di default per questo è rischio senza valore. I commit futuri sono firmati: il problema si estingue da solo.
- Invio email: congelato (P4).
- Classificatore: regex, non LLM.

## 10 · Prima azione di ogni sessione

1. `git status` pulito, branch da `main`.
2. Leggi questo file + il CLAUDE.md del modulo su cui lavori (dashboard o pipeline).
3. Verifica lo stato live minimo (campagne del cliente su cui operi) SOLO se il task lo richiede.
4. Riprendi la coda §4 dal primo item aperto. Oggi: **P0.1**.
