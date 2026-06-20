import Link from "next/link";
import { listClients } from "@/lib/clients";

export const dynamic = "force-dynamic";

// Internal landing page (for the agency). Clients never see this — they receive
// a direct /c/<slug> link. Lists known clients for quick access.
export default async function Home() {
  const clients = await listClients();
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <div className="flex items-center gap-3">
        <span className="pulse-dot" />
        <span className="text-xs uppercase tracking-widest muted">
          Instantly · Live Dashboard
        </span>
      </div>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">
        Client outbound dashboards
      </h1>
      <p className="mt-3 max-w-xl text-[15px] muted">
        Real-time, white-label dashboards built on the Instantly.ai V2 API. Each
        client gets a private shareable link — no login required. Replaces weekly
        reports with a live view they can read and comment on.
      </p>

      <div className="mt-10 grid gap-3">
        {clients.map((c) => (
          <Link
            key={c.slug}
            href={`/c/${c.slug}`}
            className="card flex items-center justify-between px-5 py-4 transition hover:border-[var(--accent)]"
          >
            <div>
              <div className="font-semibold">{c.name}</div>
              <div className="text-xs muted">/c/{c.slug}</div>
            </div>
            <span className="text-sm accent">Open →</span>
          </Link>
        ))}
      </div>

      <p className="mt-10 text-xs muted">
        Tip: configure clients in Supabase (<code>clients</code> table) or via the{" "}
        <code>DASHBOARD_CLIENTS</code> env var. With no config, the{" "}
        <Link className="accent" href="/c/demo">
          demo
        </Link>{" "}
        client runs on mock data.
      </p>
    </main>
  );
}
