import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { addFeedback, listFeedback, resolveFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });
  const items = await listFeedback(client.slug);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  const kind = ["comment", "flag", "question"].includes(body.kind) ? body.kind : "comment";
  const item = await addFeedback({
    clientSlug: client.slug,
    target: String(body.target ?? "overview"),
    targetLabel: String(body.targetLabel ?? "Overview"),
    author: String(body.author ?? "Client").slice(0, 80),
    kind,
    body: String(body.body).slice(0, 4000),
  });
  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  await resolveFeedback(client.slug, body.id, Boolean(body.resolved));
  return NextResponse.json({ ok: true });
}
