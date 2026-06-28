import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getAutomation, getAutomations, runAutomation } from "@/lib/automations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET → dry-run report for all the client's automations (writes nothing, safe to
// expose). Shows which leads WOULD be added to the step-4 campaign.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });
  if (!client.instantlyApiKey) {
    return NextResponse.json({ automations: [], note: "no api key" });
  }
  const list = getAutomations(client.slug);
  const automations = [];
  for (const a of list) {
    const report = await runAutomation(client.instantlyApiKey, a, true); // dry-run
    automations.push({ id: a.id, name: a.name, description: a.description, minDays: a.minDays, ...report });
  }
  return NextResponse.json({ automations }, { headers: { "Cache-Control": "no-store" } });
}

// POST → LIVE execution (actually adds leads). Protected by CRON_SECRET so the
// public dashboard cannot trigger writes; used by the scheduled cron.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized (live runs require CRON_SECRET)" }, { status: 401 });
  }
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client?.instantlyApiKey) {
    return NextResponse.json({ error: "Unknown client / no key" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  const automation = getAutomation(client.slug, id);
  if (!automation) return NextResponse.json({ error: "Unknown automation" }, { status: 400 });
  const report = await runAutomation(client.instantlyApiKey, automation, false); // LIVE
  return NextResponse.json({ ranAt: new Date().toISOString(), ...report });
}
