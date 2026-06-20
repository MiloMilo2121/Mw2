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
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
