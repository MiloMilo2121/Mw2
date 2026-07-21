import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { buildPipeline } from "@/lib/pipeline";
import { writeSheet, hasSheetsCreds, sheetId } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const noStore = { headers: { "Cache-Control": "no-store" } };

// GET → ANTEPRIMA (sola lettura): costruisce le righe della pipeline e le
// restituisce in JSON. Non scrive sul foglio → testabile con la sola chiave
// Instantly, senza credenziali Google. Comodo per verificare i DATI prima di
// collegare il Google Sheet.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });
  if (!client.instantlyApiKey) {
    return NextResponse.json({ error: "no api key", header: [], rows: [], count: 0 }, noStore);
  }
  try {
    const p = await buildPipeline(client);
    return NextResponse.json(
      { source: "instantly", sheetReady: hasSheetsCreds(), sheetId: sheetId(), ...p },
      noStore
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, header: [], rows: [], count: 0 }, noStore);
  }
}

// POST → SCRITTURA sul Google Sheet. Gated da CRON_SECRET, così il foglio non è
// scrivibile dalla dashboard pubblica. Costruisce la pipeline e la sincronizza.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized (scrittura richiede CRON_SECRET)" }, { status: 401 });
  }
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client?.instantlyApiKey) {
    return NextResponse.json({ error: "Unknown client / no key" }, { status: 404 });
  }
  if (!hasSheetsCreds()) {
    return NextResponse.json({ error: "Credenziali Google service-account mancanti" }, { status: 400 });
  }
  const p = await buildPipeline(client);
  const res = await writeSheet(p.header, p.rows);
  return NextResponse.json({ ranAt: new Date().toISOString(), count: p.count, ...res });
}
