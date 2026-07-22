import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { buildSnapshot } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) {
    return NextResponse.json({ error: "Unknown client" }, { status: 404 });
  }
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days")) || 30));

  const snapshot = await buildSnapshot(client, days);
  // statusMessage carries raw provider SMTP text (e.g. "550 …") for internal
  // alerting only — never expose it in the client-facing (slug-as-secret)
  // payload (§3.6). buildSnapshot keeps it server-side for the alert cron.
  const clientSafe = {
    ...snapshot,
    accounts: snapshot.accounts.map((a) => {
      const copy = { ...a };
      delete copy.statusMessage;
      return copy;
    }),
  };
  return NextResponse.json(clientSafe, {
    headers: { "Cache-Control": "no-store" },
  });
}
