"""Painel ao vivo do skip-trace PJe — mostra quantos sócios faltam varrer.

USO (terminal separado, com as MESMAS env vars do skiptrace):
  $env:SUPABASE_URL=...; $env:SUPABASE_SERVICE_ROLE_KEY=...
  python tools/pje_progress.py

Lê o universo de alvos (1x) + o marcador PJe/TJRN no CRM + o ledger local,
e re-renderiza a cada poucos segundos com barra de progresso, ritmo e ETA.
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from importlib import import_module
sk = import_module("tools.pje_rn_skiptrace")
sb, parece_pj, LEDGER = sk.sb, sk.parece_pj, sk.LEDGER

REFRESH = 6  # segundos


def _paginar(q):
    out, offset, page = [], 0, 1000
    while True:
        rows = sb(q + f"&limit={page}&offset={offset}") or []
        out.extend(rows)
        if len(rows) < page:
            break
        offset += page
    return out


def fetch_target_names():
    """Nomes-alvo (sócio PF do RN, dedup, sem PJ). Pesado — roda 1x no início."""
    q = ("empresa_contatos?select=nome,empresas!inner(uf)&papel=eq.socio"
         "&cpf_mascarado=not.is.null&cpf_mascarado=like.*%2A*"
         "&empresas.uf=eq.RN&order=nome.asc")
    names = set()
    for r in _paginar(q):
        n = (r.get("nome") or "").strip()
        if n and not parece_pj(n):
            names.add(n.upper())
    return names


def fetch_marker_names():
    """Nomes já com hit gravado no CRM (marcador PJe/TJRN). Pequeno — cada refresh."""
    q = ("empresa_contatos?select=nome,empresas!inner(uf)&papel=eq.socio"
         "&observacoes=like.*PJe%2FTJRN*&empresas.uf=eq.RN")
    return {(r.get("nome") or "").strip().upper() for r in _paginar(q) if r.get("nome")}


def read_ledger():
    rows = []
    if LEDGER.exists():
        for line in open(LEDGER, encoding="utf-8"):
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except Exception:
                    pass
    return rows


def bar(frac, width=26):
    f = max(0, min(1, frac))
    fill = int(round(f * width))
    return "█" * fill + "░" * (width - fill)


def fmt(n):
    return f"{n:,}".replace(",", ".")


def main():
    if not sk.SUPABASE_URL or not sk.SERVICE_KEY:
        print("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); return
    print("carregando universo de alvos (uma vez)...", flush=True)
    TARGET = fetch_target_names()
    U = len(TARGET)
    prev = None
    while True:
        try:
            marker = fetch_marker_names()
        except Exception:
            marker = set()
        led = read_ledger()
        led_names = {(r.get("nome") or "").upper() for r in led}
        done = (led_names | marker) & TARGET if TARGET else (led_names | marker)
        nd = len(done)
        faltam = max(0, U - nd)
        hit = sum(1 for r in led if r.get("result") == "hit")
        sp = sum(1 for r in led if r.get("result") == "sem_processo")
        sm = sum(1 for r in led if r.get("result") == "sem_match")
        ce = sum(1 for r in led if "E" in (r.get("flags") or ""))
        ct = sum(1 for r in led if "T" in (r.get("flags") or ""))
        cm = sum(1 for r in led if "@" in (r.get("flags") or ""))
        now = time.time()
        rate = eta = ""
        if prev and (now - prev[1]) > 0 and nd > prev[0]:
            rpm = (nd - prev[0]) / (now - prev[1]) * 60
            rate = f"{rpm:.1f}/min"
            if rpm > 0:
                mins = faltam / rpm
                eta = f"~{int(mins // 60)}h{int(mins % 60):02d}m"
        prev = (nd, now)
        frac = nd / U if U else 0

        sys.stdout.write("\033[2J\033[H")
        print("=" * 58)
        print("  PJe Skip-trace — Sócios PF do RN")
        print("=" * 58)
        print(f"  Universo alvo ........ {fmt(U)}")
        print(f"  Já varridos .......... {fmt(nd)}  {frac*100:5.1f}%")
        print(f"  [{bar(frac)}]")
        print(f"  Faltam ............... {fmt(faltam)}")
        print(f"  Hits no CRM .......... {fmt(len(marker & TARGET))}")
        print("-" * 58)
        print(f"  Ledger (varridos) .... {fmt(len(led_names))}")
        print(f"    acertos (CPF) ...... {fmt(hit)}")
        print(f"    com endereço ....... {fmt(ce)}")
        print(f"    com TELEFONE ....... {fmt(ct)}")
        print(f"    com email .......... {fmt(cm)}")
        print(f"    sem processo ....... {fmt(sp)}")
        print(f"    sem match (homôn.) . {fmt(sm)}")
        print("-" * 58)
        tail = f"  Ritmo: {rate or '—'}"
        if eta:
            tail += f"    ETA {eta}"
        print(tail)
        print(f"  {time.strftime('%H:%M:%S')}  ·  refresh {REFRESH}s  ·  Ctrl+C sai")
        print("=" * 58)
        time.sleep(REFRESH)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nsaindo.")
