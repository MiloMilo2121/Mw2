"""Genera un report HTML autoconsistente dei cestini per una call/presentazione.

Legge i due handoff del run (data/out/cestini.json + flags_preview.json) e produce
data/out/cestini_report.html: raggruppato per cestino (A→E, priorità), ogni agenzia
con motivo + flag evidenziati (citazione + fonte). Nessuna dipendenza esterna, offline.

  python scripts/cestini_report_html.py [--out path.html]
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "out"

CESTINO = {
    "A": ("Open House + Indipendente", "Segmento prioritario Sassi — il metodo Geriko calza già", "#34d399"),
    "B": ("Indipendente · fascia ≥ €150k", "Core, caso Cardano — fascia dove Geriko ha mostrato uplift", "#60a5fa"),
    "C": ("Indipendente · fascia < €150k", "Core, caso Varese — tagli bassi", "#22d3ee"),
    "D": ("Multi-sede / mini-franchising", "Copy multiproposta (B2)", "#fbbf24"),
    "E": ("GENERIC — dati insufficienti", "Mai scartati: istituzionale, nessuna assunzione senza evidenza", "#94a3b8"),
}
FLAG_LABEL = {"open_house": "Open House", "struttura": "Struttura",
              "fascia_prezzo": "Fascia prezzo", "nome_usabile": "Nome titolare"}
ORDER = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4}


def esc(s) -> str:
    return html.escape(str(s if s is not None else ""))


def fmt_val(tipo: str, val: str) -> str:
    if tipo == "fascia_prezzo":
        try:
            return f"€ {int(float(val)):,}".replace(",", ".")
        except (TypeError, ValueError):
            return esc(val)
    return esc(val)


def flag_row(f: dict, dom: str) -> str:
    tipo = f.get("tipo")
    val = f.get("valore")
    if val in (None, "", "unknown"):
        return ""
    conf = f.get("confidence")
    conf_s = f" · conf {conf}" if conf not in (None, "") else ""
    ev = (f.get("evidenza") or "").strip()
    src = f.get("source_url") or f"https://{dom}"
    ev_html = (f'<div class="ev">“{esc(ev)}” <a href="{esc(src)}" target="_blank">fonte ↗</a></div>'
               if ev else "")
    return (f'<div class="flag"><span class="ft">{esc(FLAG_LABEL.get(tipo, tipo))}</span>'
            f'<span class="fv">{fmt_val(tipo, val)}{esc(conf_s)}</span>{ev_html}</div>')


def lead_card(h: dict, flags: dict) -> str:
    dom = h["dominio"]
    fl = flags.get(dom, {})
    title = h.get("company") or dom
    tono = (h.get("recipe") or {}).get("tono", "")
    seq = (h.get("recipe") or {}).get("sequenza_id", "")
    badge = "CON NOME" if h.get("con_nome") else "GENERIC"
    rows = "".join(flag_row(fl[t], dom) for t in ("open_house", "struttura", "fascia_prezzo", "nome_usabile") if t in fl)
    return f"""
    <article class="card">
      <header>
        <div><h3>{esc(title)}</h3><a class="dom" href="https://{esc(dom)}" target="_blank">{esc(dom)} ↗</a></div>
        <span class="tag {'nome' if h.get('con_nome') else ''}">{badge}</span>
      </header>
      <p class="motivo"><b>Perché qui:</b> {esc(h.get('motivo'))}</p>
      <div class="flags">{rows or '<span class="muted">nessun flag con evidenza</span>'}</div>
      <footer class="muted">Sequenza <b>{esc(seq)}</b> · tono {esc(tono)}</footer>
    </article>"""


def build(cestini: list, flags: dict) -> str:
    by = {}
    for h in cestini:
        by.setdefault(h["cestino"], []).append(h)
    counts = {k: len(v) for k, v in by.items()}
    total = len(cestini)

    tiles = "".join(
        f'<div class="tile" style="--c:{CESTINO[k][2]}"><span class="n">{counts.get(k,0)}</span>'
        f'<span class="l">Cestino {k}</span></div>'
        for k in ["A", "B", "C", "D", "E"]
    )

    sections = []
    for k in sorted(by, key=lambda x: ORDER.get(x, 9)):
        name, sub, col = CESTINO[k]
        leads = by[k]
        top = ' · <span class="prio">TOP PRIORITÀ</span>' if k == "A" else ""
        if k == "E":
            doms = "".join(f'<li><a href="https://{esc(h["dominio"])}" target="_blank">{esc(h["dominio"])}</a></li>'
                           for h in leads[:60])
            more = f'<p class="muted">…e altre {len(leads)-60} agenzie.</p>' if len(leads) > 60 else ""
            body = (f'<p class="muted">Dati insufficienti dal sito (spesso siti JS-heavy senza testo estraibile). '
                    f'Non scartate: entrano nel GENERIC istituzionale.</p><ul class="egrid">{doms}</ul>{more}')
        else:
            body = "".join(lead_card(h, flags) for h in leads)
        sections.append(
            f'<section><h2 style="--c:{col}">Cestino {k} — {esc(name)} '
            f'<span class="cnt">{len(leads)}</span>{top}</h2>'
            f'<p class="sub">{esc(sub)}</p>{body}</section>'
        )

    return f"""<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Segmentazione cestini — Geriko</title>
<style>
:root{{color-scheme:dark}}
*{{box-sizing:border-box}}
body{{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
  color:#e5e9f0;background:#0a0c12;
  background-image:radial-gradient(1000px 600px at 15% -10%,rgba(52,211,153,.10),transparent),
    radial-gradient(900px 500px at 100% 0,rgba(96,165,250,.10),transparent)}}
.wrap{{max-width:1040px;margin:0 auto;padding:48px 24px 96px}}
h1{{font-size:30px;letter-spacing:-.02em;margin:0 0 6px}}
.lede{{color:#9aa4b2;margin:0 0 28px}}
.tiles{{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:0 0 40px}}
.tile{{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;
  padding:16px;text-align:center;backdrop-filter:blur(8px)}}
.tile .n{{display:block;font-size:30px;font-weight:700;color:var(--c)}}
.tile .l{{color:#9aa4b2;font-size:13px}}
.method{{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;
  padding:20px 22px;margin:0 0 44px}}
.method h4{{margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#9aa4b2}}
.method ol{{margin:0;padding-left:20px}} .method li{{margin:4px 0}}
.method .g{{color:#9aa4b2;font-size:13.5px;margin-top:12px}}
section{{margin:0 0 44px}}
h2{{font-size:20px;letter-spacing:-.01em;margin:0 0 2px;padding-left:14px;border-left:4px solid var(--c)}}
h2 .cnt{{color:#9aa4b2;font-weight:500;font-size:15px}}
.prio{{color:#34d399;font-size:12px;font-weight:700;letter-spacing:.06em}}
.sub{{color:#9aa4b2;margin:0 0 18px;padding-left:18px}}
.card{{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:16px;
  padding:18px 20px;margin:0 0 14px}}
.card header{{display:flex;justify-content:space-between;align-items:start;gap:12px}}
.card h3{{margin:0;font-size:17px}}
.dom{{color:#7dd3fc;text-decoration:none;font-size:13px}}
.tag{{font-size:11px;font-weight:700;letter-spacing:.05em;padding:4px 9px;border-radius:999px;
  background:rgba(148,163,184,.15);color:#cbd5e1;white-space:nowrap}}
.tag.nome{{background:rgba(52,211,153,.15);color:#6ee7b7}}
.motivo{{margin:12px 0 14px;font-size:14px}}
.flags{{display:grid;gap:10px}}
.flag{{background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:9px 12px}}
.ft{{font-size:12px;color:#9aa4b2;text-transform:uppercase;letter-spacing:.05em;margin-right:8px}}
.fv{{font-weight:600}}
.ev{{color:#b9c2cf;font-size:13px;margin-top:5px;font-style:italic}}
.ev a{{color:#7dd3fc;text-decoration:none;font-style:normal;font-size:12px;margin-left:4px}}
.card footer{{margin-top:12px}}
.muted{{color:#8a94a3;font-size:13px}}
.egrid{{columns:3;gap:18px;list-style:none;padding:0;margin:12px 0 0}}
.egrid li{{margin:3px 0}} .egrid a{{color:#93a4b8;text-decoration:none;font-size:13px}}
@media(max-width:720px){{.tiles{{grid-template-columns:repeat(3,1fr)}}.egrid{{columns:2}}}}
</style></head><body><div class="wrap">
<h1>Segmentazione cestini — Geriko</h1>
<p class="lede">{total} agenzie immobiliari analizzate · assegnazione deterministica in 5 cestini · ogni flag con evidenza citata dal sito.</p>
<div class="tiles">{tiles}</div>
<div class="method">
  <h4>Come si legge il "perché"</h4>
  <ol>
    <li><b>Cestino A</b> — Open House dichiarato <i>e</i> agenzia indipendente: il metodo Geriko calza già.</li>
    <li><b>Cestino B / C</b> — indipendente, split sulla mediana annunci (≥ / &lt; €150k): casi Cardano / Varese.</li>
    <li><b>Cestino D</b> — multi-sede o mini-franchising: copy multiproposta.</li>
    <li><b>Cestino E</b> — dati insufficienti: GENERIC istituzionale, mai scartate.</li>
  </ol>
  <p class="g">Ogni flag (open_house, struttura, fascia, nome titolare) è estratto dal sito con <b>citazione + fonte</b>: senza evidenza resta <i>unknown</i>, mai indovinato. Fascia di riferimento Geriko €75k–€275k (mediana uplift +9%, punta Gallarate +36,7%).</p>
</div>
{''.join(sections)}
<p class="muted" style="margin-top:60px">Generato dal run pipeline cestini · dati grezzi in Supabase (leads/flags/cestini). Report provvisorio: il gate QA (Regola Zero) certifica l'errore del classificatore prima dell'uso operativo.</p>
</div></body></html>"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT / "cestini_report.html"))
    args = ap.parse_args()
    cestini = json.loads((OUT / "cestini.json").read_text(encoding="utf-8"))
    prev = json.loads((OUT / "flags_preview.json").read_text(encoding="utf-8"))
    flags = {p["dominio"]: {f["tipo"]: f for f in p.get("flags", [])} for p in prev}
    Path(args.out).write_text(build(cestini, flags), encoding="utf-8")
    print(f"report → {args.out} ({len(cestini)} agenzie)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
