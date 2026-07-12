# Piano di implementazione — "Campaign Manager Agent" (Fase 1: Copilot)

> Handoff per l'agente locale (con `ANTHROPIC_API_KEY` + `Instantly_AXEND` per i test).
> Repo: `milomilo2121/mw2`, app in `dashboard/` (Next.js 15 App Router, TS, Tailwind v4).
> Branch di lavoro: `claude/instantly-live-dashboard-4t6trb` (poi merge `--no-ff` su `main`).

---

## 1. Obiettivo & decisioni prese
Costruire un **agente "manager di campagna"** che osserva la campagna, legge le risposte,
**prepara** le repliche, e **suggerisce** ottimizzazioni. Scelte dell'utente:
- **Partiamo dal "Copilot"**: l'agente PROPONE (risposte + ottimizzazioni + nuove agenzie), l'umano approva in una tab **"Agent"**.
- **Autonomia invii = sempre approvazione umana** all'inizio. Nessun invio automatico esterno in Fase 1. Si allenta per categoria nelle fasi successive, guidati dai numeri.

Principio guida: **autonomia piena su read/analisi/suppress/sourcing; cancello umano su ogni messaggio in uscita** verso i prospect (rischio reputazione dominio).

---

## 2. Stack esistente da RIUSARE (già in repo)
`dashboard/src/lib/`
- `instantly.ts` — client V2. Funzioni già pronte: `fetchEmails(apiKey,{campaignId,maxEmails})`, `addToBlocklist(apiKey,value)`, `addLeadsToCampaign(apiKey,campaignId,leads)` (idempotente), `fetchLead(apiKey,email)`, `fetchCampaignSequence(apiKey,campaignId)`, `fetchCampaignSteps(apiKey,campaignId,...)`, `getScopedCampaignIds(apiKey,{accountKeywords,nameKeywords})`, `getScopedLiteCampaigns`, `fetchAccounts`, `fetchLeads`, `fetchRawCampaignLeads`. `BASE_URL="https://api.instantly.ai/api/v2"`, helper `api<T>()` (GET) + `InstantlyError`.
- `replies.ts` — `categorizeReply({from,subject,body})` → `positivo|opt_out|persona_sbagliata|gia_cliente|auto_reply|altro`; `firstMessage()` (taglia la storia citata); `AUTO_SUPPRESS`.
- `metrics.ts` — `buildSnapshot(client, days)` → totals/campaigns/daily/accounts.
- `clients.ts` — `getClient(slug)` (client `geriko` con `campaignAccountMatch:["metodogeriko"]`, `campaignMatch:["geriko"]`), `listClients()`.
- `verified.ts` — `getVerified(email)` (telefono/sito/ruolo/città dall'archivio arricchito `data/geriko_verified.json`).
- `format.ts` — fmtInt/fmtPct/fmtDateTime/`rate()`.

`dashboard/src/components/dashboard/`
- Pattern tab: `Shell.tsx` (union `Tab`, array `TABS`, switch di render), `hooks.ts` (SWR `useSnapshot/useLeads/useReplies/...`, fetcher condiviso), tab self-fetching (`RepliesTab`, `AutomationsTab`) prendono solo `{slug}`.
- Route pattern: `src/app/api/c/[slug]/<x>/route.ts` → `await params` → `getClient` (404) → `client.instantlyApiKey` → fallback mock → `Cache-Control: no-store`.
- Cron: `src/app/api/cron/automations/route.ts` gated da `CRON_SECRET` (Vercel manda `Authorization: Bearer <CRON_SECRET>`). `vercel.json` crons.
- Automazioni: `src/lib/automations.ts` (`runAutomation`, `runSuppression`) — pattern per azioni schedulate.

---

## 3. Architettura Fase 1 (Copilot)
Loop concettuale (in Fase 1 gira **on-demand** dalla tab + un cron di refresh opzionale):
1. **Observe** (autonomo, read-only): analytics campagne, risposte (ue_type 2), step/varianti, lead caldi. Riusa buildSnapshot + fetchEmails + fetchCampaignSteps + fetchLeads.
2. **Suggest** (euristico, NO LLM): `optimizer.ts` produce raccomandazioni.
3. **Draft** (LLM, gated da `ANTHROPIC_API_KEY`): `agent.ts` genera bozze di risposta per ogni reply reale, poi **revisori agentici** le validano.
4. **Approve** (umano): tab "Agent" → l'umano rilegge/modifica → **Copia** (invio manuale in Instantly) in Fase 1. (Invio 1-click via API in Fase 2.)

---

## 4. Componenti da costruire

### 4.1 `src/lib/optimizer.ts` (euristico, nessun LLM)
```ts
export type Suggestion = {
  id: string;
  severity: "alta" | "media" | "info";
  area: "copy" | "deliverability" | "follow-up" | "lista" | "sequenza";
  title: string;      // es. "Variante B step 2 sotto-performa"
  detail: string;     // spiegazione + numeri
  action?: string;    // azione consigliata (testo)
};
export function buildSuggestions(input: {
  campaigns: CampaignAnalytics[];           // da buildSnapshot
  stepsByCampaign: Record<string, CampaignStep[]>; // fetchCampaignSteps per campagna attiva
  replies: { category: ReplyCategory; from: string; ts: string }[];
  hotLeads: { email: string; company: string; interest: number; lastContact: string|null; phone: string }[];
  accounts: AccountHealth[];
}): Suggestion[];
```
Regole (esempi, tutte calcolabili dai dati):
- **Varianti A/B**: per ogni step, se `reply_rate(varianteX) < 0.5 * best` con volume ≥ soglia (es. ≥40 inviate) → suggerisci pausa/sostituzione. (Da `fetchCampaignSteps`: sent/opened/replies per step+variant.)
- **Drop-off sequenza**: se lo step N ha reply_rate molto < step N-1 → suggerisci nuovo oggetto/step.
- **Deliverability**: bounce campagna > 4% o account con `healthScore` basso/warmup basso → warning.
- **Open rate MPP**: se open>90% e reply ~0 → nota "aperture gonfiate (Apple MPP), guarda i click".
- **Follow-up caldi**: lead `interest>0` o cliccatori con telefono e `lastContact` vecchio (>3-5g) → "ricontatta". (Es. Gianluca.)
- **Persone sbagliate**: conta reply `persona_sbagliata` → "chiedi referente su queste N".
- **Opt-out gestiti**: conferma quante opt-out bloccate (rassicurazione).
- **Lista in esaurimento**: se lead attivi rimanenti bassi → "aggiungi agenzie (sourcing)".

### 4.2 `src/lib/agent.ts` (LLM, gated)
```ts
export type DraftResult = {
  category: ReplyCategory;
  draftSubject: string;
  draftBody: string;
  rationale: string;
  confidence: number;         // 0-1
  reviews: ReviewVerdict[];   // dai revisori
  approved: boolean;          // true se tutti i revisori passano
  llm: boolean;               // false = fallback template (chiave assente)
};
export async function draftReply(input: {
  reply: { from: string; subject: string; body: string; category: ReplyCategory };
  lead: { firstName: string; company: string; role: string; openedApproach: string; clickedApproach: string };
  brand: BrandVoice;          // vedi §5
}): Promise<DraftResult>;
```
- Se `process.env.ANTHROPIC_API_KEY` assente → **fallback template** per categoria (nessun LLM), `llm:false`, `approved:false` (segna "aggiungi ANTHROPIC_API_KEY per bozze su misura").
- Se presente → chiama Claude (SDK `@anthropic-ai/sdk`, model consigliato `claude-sonnet-5` per costo/qualità; `claude-opus-4-*` per i casi difficili). Vedi prompt §5.
- **Guardrail hard PRIMA di tutto** (codice, non LLM): se `category ∈ {opt_out}` → NON generare, ritorna "non contattare (opt-out)". Se lead in blocklist → idem. Se `persona_sbagliata` → playbook "chiedi gentilmente il referente" (non ripitchare).

### 4.3 Revisori agentici — `src/lib/agent_reviewers.ts`
Pattern **generatore → critici indipendenti → consenso** (come adversarial-verify). 3 revisori, ognuno una chiamata Claude separata con lente diversa, output strutturato `{pass:boolean, reason:string}`:
1. **Brand/tono** — rispetta voce Geriko, italiano corretto, conciso, niente hype.
2. **Fatti/claims** — NESSUN numero o affermazione non presente nel contesto fornito (no percentuali inventate, no promesse). Se la bozza inventa dati → `pass:false`.
3. **Compliance/deliverability** — onora opt-out, nome corretto, niente parole-spam (denylist), CTA chiara e non aggressiva.
```ts
export async function reviewDraft(draft: DraftResult, ctx): Promise<ReviewVerdict[]>;
// approved = reviews.every(r => r.pass)  (consenso pieno). Altrimenti → all'umano con le ragioni.
```
> Nota: i revisori sono chiamate LLM aggiuntive → hanno senso solo con la chiave. Senza chiave, la bozza template va comunque all'umano (che è il revisore finale in Fase 1).

### 4.4 Route `src/app/api/c/[slug]/agent/route.ts`
- **GET** → `{ suggestions, drafts }`:
  - `suggestions` = `buildSuggestions(...)` (assembla input: buildSnapshot per campaigns/accounts, fetchCampaignSteps per le 2 campagne attive Sassi, fetchEmails→categorize per replies, fetchLeads per hotLeads).
  - `drafts` = per ogni reply reale (ue_type 2, categoria ≠ auto_reply, mittente non in blocklist) → `draftReply(...)` (+ reviewers se chiave presente). Riusa la logica lead-context di `/api/c/[slug]/lead` (opened/clicked approach).
  - `no-store`.
- **POST** (Fase 2, predisporre ma non attivare l'invio): `{action:"send_reply", email, subject, body}` gated da approvazione — in Fase 1 lasciare stub che ritorna 501/"invio manuale". L'endpoint reale di invio è l'Instantly **reply** (verificare: MCP tool `reply_to_email`; endpoint V2 tipo `POST /emails/reply` — DA CONFERMARE con test).

### 4.5 UI — `src/components/dashboard/AgentTab.tsx` + `useAgent` in `hooks.ts` + wiring in `Shell.tsx`
- `useAgent(slug)` = SWR `/api/c/${slug}/agent`, refreshInterval 120_000.
- Tab **"Agent"** in `TABS` (dopo "Risposte"), union `Tab`, import, riga `{tab==="agent" && <AgentTab slug={slug}/>}`.
- Layout:
  - **Sezione Ottimizzazioni**: card per `Suggestion`, badge severità (alta=`--bad`, media=`--warn`, info=muted), area, titolo, dettaglio, azione.
  - **Sezione Bozze risposte**: per ogni draft → mittente+azienda, categoria, la reply originale (snippet), la **bozza** (subject+body) in un box editabile (`<textarea>`), badge revisori (✓/✗ con reason in tooltip), stato `approvato`/`da rivedere`, pulsanti **Copia** (clipboard) e **Modifica**. In Fase 1 niente "Invia" (o disabilitato con tooltip "Fase 2"). Se `llm:false` → banner "Aggiungi ANTHROPIC_API_KEY per bozze su misura".
- Riusa classi `card`, `muted`, `accent`, colori `--good/--warn/--bad`, `FeedbackButton target="agent"`.

---

## 5. Prompt design (LLM)
`BrandVoice` (hardcoded, poi configurabile): mittenti Geriko = **Rosa Carretta** / **Emanuele Sassi** (metodogeriko.it); tono professionale-diretto, italiano, no hype, target = **agenzie immobiliari**; value prop = metodo Geriko (open house / gestione offerte / acquisizione incarichi). CTA tipica = proporre una call breve.

**System prompt generatore** (sintesi):
> Sei l'assistente SDR di Geriko. Scrivi in italiano, tono professionale e diretto, MAI hype. Rispondi SOLO in base al contesto fornito: non inventare numeri, nomi, casi studio o promesse. Rispetta la categoria della risposta ricevuta:
> - `positivo` → ringrazia, riaggancia al punto che ha sollevato, proponi una call breve (offri 2 slot o un link).
> - `persona_sbagliata` → scusati, chiedi gentilmente chi è il referente giusto. NON ripitchare.
> - `gia_cliente` → ringrazia, chiedi se serve supporto, non vendere.
> - `altro` → rispondi al merito, poi CTA soft.
> Output JSON: {subject, body, rationale, confidence}.

**Input al modello**: testo reply (primo messaggio pulito), a quale email/approccio ha risposto/aperto/cliccato, azienda+ruolo+nome, categoria.

**Revisori**: 3 system prompt separati (brand, fatti, compliance) con output `{pass, reason}`. `approved = tutti pass`.

**Few-shot consigliato**: 1 esempio positivo (stile Gianluca "mi dica quando passa da Milano" → bozza che propone la call a Milano), 1 persona_sbagliata (Italia Homes "non esiste nessun Roberto" → chiedi referente).

---

## 6. Guardrail HARD (in codice, non affidati all'LLM)
1. Mai generare/inviare a **blocklist** o categoria **opt_out**. (Check con `addToBlocklist`/lista + `categorizeReply`.)
2. **Un reply per thread**; niente invii multipli.
3. **Denylist parole-spam** + rifiuto se la bozza contiene numeri/claim non presenti nel contesto (il revisore "fatti" è la seconda barriera).
4. **Italiano** + voce brand bloccata; nome destinatario corretto (dal lead).
5. **Approvazione umana** obbligatoria prima di ogni invio (Fase 1: solo copia manuale).
6. Rispetta **rate limit** e limiti giornalieri Instantly; per nuovo copy usa **canary** (test su ~20 lead prima del rollout).
7. **Audit log** di ogni bozza/decisione + ragioni revisori.

---

## 7. Dati Instantly — endpoint & campi (VERIFICATI in questa sessione)
- **Leggere risposte**: `GET /emails?campaign_id=<id>&limit=100` (paginare con `next_starting_after`). Inbound reply = **`ue_type === 2`** (1 = inviata). Campi: `from_address_email`, `subject` (il "Re: X" dice a cosa hanno risposto), `body.{text,html}`, `timestamp_email`, `campaign_id`, `lead`, `step`. ⚠️ `?lead_id=` **viene IGNORATO** → filtra lato codice per `from_address_email`.
- **Sequenza/oggetti (approcci)**: `GET /campaigns/{id}` → `sequences[0].steps[].variants[].subject` (con `{{firstName}}` da renderizzare).
- **Engagement per lead**: `email_opened_step`/`email_opened_variant`, `email_clicked_step`/`email_clicked_variant`, `email_open_count`/`click_count`/`reply_count`, `lt_interest_status` (1=interessato, -1=non int., -2=persona sbagliata, -3=perso), `status_summary.lastStep.stepID` = `"seq_step_variant"`.
- **Step analytics A/B**: `GET /campaigns/analytics/steps` (già in `fetchCampaignSteps`) → sent/opened/uniqueOpened/replies/clicks per step+variante.
- **Aggiungere lead (copia in campagna)**: `POST /leads` con `{campaign, email, first_name, company_name, skip_if_in_campaign:false, skip_if_in_workspace:false}` (entrambi FALSE per copiare anche se già in altra campagna). Idempotenza: leggere prima le email già nella target e saltarle (già in `addLeadsToCampaign`).
- **Blocklist (opt-out)**: `POST /api/v2/block-lists-entries` body `{bl_value:"email o dominio"}`. Idempotente (ri-POST → 200, stesso id). Lista via `?search=` (la GET senza search torna vuota).
- **Inviare una risposta** (Fase 2): DA CONFERMARE con test — MCP tool `reply_to_email`; endpoint V2 probabile `POST /emails/reply` (l'agente locale lo verifichi con una prova su una casella di test, NON su un prospect reale).
- **Pausa/attiva variante o campagna** (Fase 2/3): MCP `pause_campaign`/`activate_campaign`, e update sequence via `PATCH /campaigns/{id}` (verificare shape).
- **Marcare "gestito/chiamato"**: `leads_update_interest_status` o **lead labels** (`lead_labels_*`) — utile per escludere dai prossimi export/azioni.
- **Sourcing nuove agenzie** (Fase 2): scraper esterni → verifica email (MillionVerifier o enrichment Instantly) → dedup vs esistenti + blocklist → `addLeadsToCampaign`.

Le **7 campagne Geriko** (per test): CON NOME Sassi `1dba8a9a-…`, GENERIC Sassi `070607dd-…`, Sassi v1 `e98d3fe7-…`, Carretta `0b4a01cc-…`, GENERIC Sassi copy `f230572e-…`, GENERIC Rosa4 `b4d3fda9-…`, CON NOME Rosa4 `a69e6b45-…`. Scoping dinamico: `getScopedCampaignIds(key,{accountKeywords:["metodogeriko"],nameKeywords:["geriko"]})`.

---

## 8. Env vars richieste
- `ANTHROPIC_API_KEY` — **nuova**, per generazione/revisione. Senza → fallback template (nessun LLM).
- `Instantly_AXEND` — già esistente (chiave Instantly, letta da `resolveApiKey`).
- `CRON_SECRET` — già usata (per il refresh schedulato dell'agente, opzionale in Fase 1).
- (Opzionale) `AGENT_MODEL` — override modello (default `claude-sonnet-5`).
Dipendenza npm: `@anthropic-ai/sdk` (`npm i @anthropic-ai/sdk` in `dashboard/`).

---

## 9. Verifica end-to-end (per l'agente locale con le API)
1. `npm run build` pulito.
2. `optimizer`: `GET /api/c/geriko/agent` → deve produrre suggerimenti reali coerenti (es. varianti sotto-performanti dagli step, "Gianluca interessato da ricontattare", "N persone sbagliate", warning deliverability se presenti).
3. `draftReply` **con** `ANTHROPIC_API_KEY`: per la reply di **Gianluca** (positivo, "mi dica quando passa da Milano") → bozza in italiano che propone una call a Milano, `approved:true`; per **Italia Homes** (persona_sbagliata, "non esiste nessun Roberto") → bozza che chiede il referente, NON ripitcha.
4. **Test revisori**: iniettare artificialmente un claim falso ("abbiamo aumentato le vendite del 300%") → il revisore "fatti" deve dare `pass:false` e la bozza risultare "da rivedere".
5. **Guardrail**: una reply opt-out non deve generare bozza; un mittente in blocklist deve essere saltato.
6. UI: tab "Agent" mostra ottimizzazioni + bozze con badge revisori e pulsante Copia; banner se manca la chiave.
7. Commit su `claude/instantly-live-dashboard-4t6trb`, merge `--no-ff` su `main`, push. **Redeploy** su Vercel (ricordare: la produzione va comunque rideployata — la tab Risposte/Agent non è ancora online).

---

## 10. Roadmap (contesto fasi successive)
- **Fase 2 — Semi-autonomo**: invio 1-click delle bozze approvate (endpoint reply verificato); auto-invio SOLO categorie sicure; auto-pausa varianti perdenti (dopo significatività); sourcing autonomo agenzie verificate; marcatura "gestito" via label.
- **Fase 3 — Copy testing autonomo**: generatore+revisori creano e testano varianti in A/B con canary + promozione automatica delle vincenti; l'umano setta obiettivi/guardrail.
- **Fase 4 — Manager completo**: loop chiuso su cron con monitoraggio (reply/positivi/bounce/complaint), rollback automatico, review umana settimanale.

Autonomia crescente SOLO se i numeri la giustificano; il cancello umano sull'outbound si allenta per categoria, mai in blocco.
