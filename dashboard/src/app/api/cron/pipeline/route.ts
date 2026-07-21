import { NextResponse } from "next/server";
import { listClients, getClient } from "@/lib/clients";
import { buildPipeline } from "@/lib/pipeline";
import { writeSheet, hasSheetsCreds, sheetId } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cron (vedi vercel.json): sincronizza la pipeline inbound sul Google Sheet del
// setter, in modo dinamico. Gated da CRON_SECRET (Vercel Cron manda il Bearer).
// SOLA LETTURA verso Instantly; scrive solo sul foglio. Finché non ci sono le
// credenziali Google service-account il cron non scrive (400 documentato).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasSheetsCreds()) {
    return NextResponse.json(
      { error: "Credenziali Google service-account mancanti — nessuna scrittura" },
      { status: 400 }
    );
  }

  // Un solo foglio configurato (PIPELINE_SHEET_ID). Sincronizziamo il primo
  // cliente live con righe > 0 (oggi: Geriko). Per fogli multi-cliente serve una
  // mappatura slug→sheetId dedicata (evoluzione futura).
  const results: Record<string, unknown> = {};
  for (const summary of await listClients()) {
    const client = await getClient(summary.slug);
    if (!client?.instantlyApiKey) continue;
    try {
      const p = await buildPipeline(client);
      if (p.count === 0) {
        results[client.slug] = { count: 0, wrote: false };
        continue;
      }
      const res = await writeSheet(p.header, p.rows);
      results[client.slug] = { count: p.count, ...res };
      break; // un solo foglio di destinazione
    } catch (err) {
      results[client.slug] = { error: (err as Error).message };
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), sheetId: sheetId(), results });
}
