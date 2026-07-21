// ─────────────────────────────────────────────────────────────────────────────
// sheets.ts — writer minimale per Google Sheets (API v4) con auth service-account.
//
// Nessuna dipendenza aggiunta: firma un JWT RS256 con `crypto`, ottiene un access
// token OAuth, poi svuota il tab e riscrive intestazione + righe (values API).
//
// Env richieste (vedi .env.example):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL        — email del service account
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  — private key PEM (con \n letterali)
//   PIPELINE_SHEET_ID                   — id del foglio (default: quello Geriko)
//   PIPELINE_SHEET_TAB                  — nome tab (opz.; default = primo foglio)
//
// Il foglio va CONDIVISO (Editor) con l'email del service account.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// Foglio di default (dalla richiesta AXEND): pipeline Geriko per il setter.
export const DEFAULT_SHEET_ID = "1VVwH4BaqFAoprifIqVKv9R9kZn59FnEmEiwS7H2OObE";

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function creds(): { email: string; key: string } | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !key) return null;
  // Le env spesso arrivano con \n letterali → riportali a newline reali.
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  return { email, key };
}

export function hasSheetsCreds(): boolean {
  return creds() !== null;
}

export function sheetId(): string {
  return process.env.PIPELINE_SHEET_ID || DEFAULT_SHEET_ID;
}

/** Firma il JWT del service account e ottiene un access token OAuth. */
async function getAccessToken(): Promise<string> {
  const c = creds();
  if (!c) throw new Error("Google service-account credentials mancanti");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: c.email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claim}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(c.key);
  const assertion = `${signingInput}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Google token → ${res.status} ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("Google token: nessun access_token");
  return j.access_token;
}

/** Titolo del tab: quello indicato in env, altrimenti il primo foglio del file. */
async function resolveTab(token: string, id: string): Promise<string> {
  const wanted = process.env.PIPELINE_SHEET_TAB;
  if (wanted) return wanted;
  const res = await fetch(`${SHEETS_BASE}/${id}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google meta → ${res.status}`);
  const j = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
  return j.sheets?.[0]?.properties?.title || "Foglio1";
}

export type SheetWriteResult = {
  ok: boolean;
  rows: number;
  tab?: string;
  error?: string;
};

/**
 * Scrive intestazione + righe sul foglio: svuota il tab e riscrive da A1.
 * Sovrascrittura completa a ogni run → il foglio riflette sempre lo stato attuale.
 */
export async function writeSheet(
  header: string[],
  rows: (string | number)[][],
  opts: { id?: string } = {}
): Promise<SheetWriteResult> {
  try {
    const id = opts.id || sheetId();
    const token = await getAccessToken();
    const tab = await resolveTab(token, id);
    const enc = encodeURIComponent(tab);

    // 1. Svuota il contenuto precedente del tab.
    const clr = await fetch(`${SHEETS_BASE}/${id}/values/${enc}:clear`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!clr.ok) {
      const t = await clr.text().catch(() => "");
      return { ok: false, rows: 0, tab, error: `clear → ${clr.status} ${t.slice(0, 200)}` };
    }

    // 2. Riscrive intestazione + righe da A1 (RAW).
    const values = [header, ...rows];
    const url = `${SHEETS_BASE}/${id}/values/${enc}!A1?valueInputOption=RAW`;
    const put = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ range: `${tab}!A1`, majorDimension: "ROWS", values }),
    });
    if (!put.ok) {
      const t = await put.text().catch(() => "");
      return { ok: false, rows: 0, tab, error: `write → ${put.status} ${t.slice(0, 200)}` };
    }
    return { ok: true, rows: rows.length, tab };
  } catch (err) {
    return { ok: false, rows: 0, error: (err as Error).message };
  }
}
