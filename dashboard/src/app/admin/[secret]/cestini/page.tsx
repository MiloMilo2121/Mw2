import { getCestiniReport, cestinoKeys, type CestinoLead } from "@/lib/cestini";

export const dynamic = "force-dynamic";

const META: Record<string, { name: string; sub: string; color: string }> = {
  A: { name: "Open House + Indipendente", sub: "Segmento prioritario Sassi — il metodo Geriko calza già", color: "#34d399" },
  B: { name: "Indipendente · fascia ≥ €150k", sub: "Core, caso Cardano", color: "#60a5fa" },
  C: { name: "Indipendente · fascia < €150k", sub: "Core, caso Varese", color: "#22d3ee" },
  D: { name: "Multi-sede / mini-franchising", sub: "Copy multiproposta (B2)", color: "#fbbf24" },
  E: { name: "GENERIC — dati insufficienti", sub: "Mai scartati: istituzionale, nessuna assunzione", color: "#94a3b8" },
};
const FLAG_LABEL: Record<string, string> = {
  open_house: "Open House", struttura: "Struttura", fascia_prezzo: "Fascia prezzo", nome_usabile: "Nome titolare",
};

function fmtVal(tipo: string, v: string | null): string {
  if (v == null) return "";
  if (tipo === "fascia_prezzo") {
    const n = Number(v);
    return Number.isFinite(n) ? "€ " + n.toLocaleString("it-IT") : v;
  }
  return v;
}

function LeadCard({ lead }: { lead: CestinoLead }) {
  const rows = ["open_house", "struttura", "fascia_prezzo", "nome_usabile"]
    .map((t) => lead.flags[t])
    .filter((f) => f && f.valore && f.valore !== "unknown");
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 mb-3.5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-semibold">{lead.company || lead.dominio}</h3>
          <a href={`https://${lead.dominio}`} target="_blank" rel="noreferrer" className="text-[13px] text-sky-300">
            {lead.dominio} ↗
          </a>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide"
          style={{ background: lead.conNome ? "rgba(52,211,153,.15)" : "rgba(148,163,184,.15)", color: lead.conNome ? "#6ee7b7" : "#cbd5e1" }}
        >
          {lead.conNome ? "CON NOME" : "GENERIC"}
        </span>
      </header>
      <p className="my-3 text-sm">
        <b>Perché qui:</b> {lead.motivo}
      </p>
      <div className="grid gap-2.5">
        {rows.length === 0 && <span className="text-[13px] text-neutral-400">nessun flag con evidenza</span>}
        {rows.map((f) => (
          <div key={f.tipo} className="rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2">
            <span className="mr-2 text-[12px] uppercase tracking-wide text-neutral-400">{FLAG_LABEL[f.tipo] ?? f.tipo}</span>
            <span className="font-semibold">
              {fmtVal(f.tipo, f.valore)}
              {f.confidence != null && <span className="text-neutral-400"> · conf {f.confidence}</span>}
            </span>
            {f.evidenza && (
              <div className="mt-1.5 text-[13px] italic text-neutral-300">
                “{f.evidenza}”{" "}
                <a href={f.sourceUrl || `https://${lead.dominio}`} target="_blank" rel="noreferrer" className="not-italic text-sky-300">
                  fonte ↗
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
      <footer className="mt-3 text-[13px] text-neutral-400">
        Sequenza <b>{lead.sequenzaId}</b> · tono {lead.tono}
      </footer>
    </article>
  );
}

export default async function CestiniAdminPage({
  searchParams,
}: {
  params: Promise<{ secret: string }>;
  searchParams: Promise<{ client?: string; run?: string }>;
}) {
  const { client = "geriko", run } = await searchParams;
  const report = await getCestiniReport(client, run);

  if (!report) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-bold">Cestini — {client}</h1>
        <p className="mt-3 text-neutral-400">
          Nessun run trovato su Supabase per questo cliente (o Supabase non configurato). Esegui la pipeline
          (<code>make run</code>) con <code>SUPABASE_URL</code>/<code>SUPABASE_SERVICE_ROLE_KEY</code> impostate.
        </p>
      </main>
    );
  }

  const keys = cestinoKeys().filter((k) => report.byCestino[k]?.length);

  return (
    <main className="mx-auto max-w-[1040px] px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Segmentazione cestini — {client}</h1>
      <p className="mt-1.5 text-neutral-400">
        {report.total} agenzie · run del {new Date(report.startedAt).toLocaleString("it-IT")} · ogni flag con evidenza citata.
      </p>

      <div className="mt-10 grid grid-cols-5 gap-3">
        {cestinoKeys().map((k) => (
          <div key={k} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <span className="block text-3xl font-bold" style={{ color: META[k].color }}>
              {report.counts[k] ?? 0}
            </span>
            <span className="text-[13px] text-neutral-400">Cestino {k}</span>
          </div>
        ))}
      </div>

      {report.qa.length > 0 && (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-[13px]">
          <span className="text-neutral-400">QA per flag: </span>
          {report.qa.map((q) => (
            <span key={q.flagTipo} className="mr-3">
              {q.flagTipo}: {(q.errorRate * 100).toFixed(0)}% {q.approvato ? "✓" : "✗"}
            </span>
          ))}
        </div>
      )}

      <div className="mt-10 space-y-11">
        {keys.map((k) => {
          const leads = report.byCestino[k];
          return (
            <section key={k}>
              <h2 className="border-l-4 pl-3.5 text-xl font-semibold" style={{ borderColor: META[k].color }}>
                Cestino {k} — {META[k].name} <span className="font-normal text-neutral-400">{leads.length}</span>
                {k === "A" && <span className="ml-2 text-xs font-bold tracking-wide text-emerald-400">TOP PRIORITÀ</span>}
              </h2>
              <p className="mb-4 pl-4.5 text-neutral-400">{META[k].sub}</p>
              {k === "E" ? (
                <div className="pl-1">
                  <p className="mb-3 text-[13px] text-neutral-400">
                    Dati insufficienti dal sito. Non scartate: entrano nel GENERIC istituzionale.
                  </p>
                  <ul className="columns-3 gap-4 [&>li]:mb-1">
                    {leads.slice(0, 90).map((l) => (
                      <li key={l.leadId}>
                        <a href={`https://${l.dominio}`} target="_blank" rel="noreferrer" className="text-[13px] text-neutral-400">
                          {l.dominio}
                        </a>
                      </li>
                    ))}
                  </ul>
                  {leads.length > 90 && <p className="mt-2 text-[13px] text-neutral-500">…e altre {leads.length - 90} agenzie.</p>}
                </div>
              ) : (
                leads.map((l) => <LeadCard key={l.leadId} lead={l} />)
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
