#!/usr/bin/env python3
"""Multi-state PJe skip-trace (RN, PB, PR, RS, SC).

Suporta múltiplos Tribunais de Justiça. Roda em série, respeitando limites diários por TJ.
Cada TJ tem sua própria sessão, limite, e marcador no CRM.

Uso:
  python pje_multi_tj.py --limit 100 --tj rn,pb,pr,rs,sc
  python pje_multi_tj.py --limit 150 --tj rn  # só RN
  python pje_multi_tj.py --check  # verifica acessibilidade de cada TJ
"""

import os
import sys
import argparse
import subprocess
import json
from pathlib import Path
from datetime import datetime

# Mapa de TJs: url, estado, nome, SISTEMA de processo eletrônico.
# ⚠️ LIÇÃO (verificado 15/06/2026): nem todo TJ usa PJe. O parser do PJe SÓ serve
# pra estados PJe. RS/SC usam eproc (ver eproc_skiptrace.py); PR abandonou o PJe
# (virou Projudi). Por isso "system" importa mais que "has_cloudflare".
# Fonte de verdade canônica dos sistemas = src/lib/tjSystems.ts (frontend); mantido em sincronia.
# viable: True=expõe petição a advogado não-parte | False=inviável | None=a confirmar.
TRIBUNALS = {
    "rn": {
        "url": "pje1g.tjrn.jus.br", "state": "RN", "name": "TJRN", "system": "pje",
        "scraper": "pje_rn_skiptrace.py", "viable": True,
        "note": "ativo; sessao persistente (sem CDP)",
    },
    "rs": {
        "url": "eproc1g.tjrs.jus.br", "state": "RS", "name": "TJRS", "system": "eproc",
        "scraper": "eproc_skiptrace.py --tj rs --cdp", "viable": True,
        "note": "pronto; precisa A3 via CDP (--inspect 1x p/ calibrar)",
    },
    "sc": {
        "url": "eproc1g.tjsc.jus.br", "state": "SC", "name": "TJSC", "system": "eproc",
        "scraper": "eproc_skiptrace.py --tj sc --cdp", "viable": True,
        "note": "pronto; precisa A3 via CDP (--inspect 1x p/ calibrar)",
    },
    "pr": {
        "url": "projudi.tjpr.jus.br", "state": "PR", "name": "TJPR", "system": "projudi",
        "scraper": "projudi_skiptrace.py --cdp", "viable": None,
        "note": "scaffold; seletores a confirmar via --inspect (A3)",
    },
    "pb": {
        "url": "pje1g.tjpb.jus.br", "state": "PB", "name": "TJPB", "system": "pje",
        "scraper": "(bloqueado)", "viable": False,
        "note": "Cloudflare protege o dominio todo -> inviavel",
    },
    "sp": {
        "url": "esaj.tjsp.jus.br", "state": "SP", "name": "TJSP", "system": "esaj",
        "scraper": "(bloqueado)", "viable": False,
        "note": "e-SAJ nao expoe autos a nao-parte; eproc-SP ~0 pendente -> inviavel",
    },
}


def check_tribunal_access(tj_code: str) -> dict:
    """Testa acessibilidade do tribunal (sem Playwright, só HTTP GET).

    'No ar' = QUALQUER resposta HTTP (200/302/403/405...). PJe/eproc respondem
    403/405 a um GET na raiz sem rota/método — isso é NORMAL, não bloqueio.
    Só conta como Cloudflare se vier o desafio anti-bot real (cf-ray/cf-mitigated/
    "Just a moment"/challenge-platform). Por isso GET (não HEAD) e leitura do corpo.

    Retorna: { reachable: bool, cloudflare: bool|None, status: int|None, error: str|None }
    """
    import requests

    if tj_code not in TRIBUNALS:
        return {"reachable": False, "cloudflare": None, "status": None,
                "error": f"TJ desconhecido: {tj_code}"}

    url = f"https://{TRIBUNALS[tj_code]['url']}"
    ua = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
    try:
        resp = requests.get(url, headers=ua, timeout=8, allow_redirects=True)
        h = {k.lower(): v for k, v in resp.headers.items()}
        body = (resp.text[:2000] or "").lower()
        # CF na frente (CDN) != CF bloqueando. Gov BR usa CF como CDN e PASSA o trafego
        # (RS = server:cloudflare + cf-ray, mas devolve 200 com a pagina de login real).
        cf_present = bool(h.get("cf-ray") or h.get("cf-mitigated")
                          or "cloudflare" in h.get("server", "").lower())
        challenge = any(m in body for m in ("just a moment", "cf-browser-verification",
                                            "/cdn-cgi/challenge-platform"))
        # Bloqueio REAL = desafio no corpo OU status de bloqueio servido pelo CF.
        cf_blocked = challenge or (cf_present and resp.status_code in (403, 429, 503))
        return {"reachable": True, "cf_present": cf_present, "cloudflare": cf_blocked,
                "status": resp.status_code, "final_url": resp.url, "error": None}
    except Exception as e:
        return {"reachable": False, "cloudflare": None, "status": None, "error": str(e)}


def list_tj_targets(tj_code: str, limit: int = 100) -> list:
    """Lista sócios PF de um estado que ainda não foram enriquecidos via PJe.

    Retorna: [{ nome, cpf_mascarado, empresa_id }, ...]
    """
    import subprocess

    state = TRIBUNALS[tj_code]["state"]
    marker = f"PJe/{TRIBUNALS[tj_code]['name']}"

    sql = f"""
    SELECT DISTINCT
      ec.nome,
      ec.cpf_mascarado,
      ec.empresa_id,
      e.nome as empresa_nome,
      e.municipio
    FROM empresa_contatos ec
    JOIN empresas e ON ec.empresa_id = e.id
    WHERE
      e.uf = '{state}'
      AND ec.papel = 'socio'
      AND ec.cpf_mascarado IS NOT NULL
      AND ec.cpf_mascarado LIKE '%*%'
      AND ec.observacoes NOT ILIKE '%{marker}%'
    ORDER BY ec.nome
    LIMIT {limit};
    """

    # Rodar query via supabase CLI
    env = os.environ.copy()
    db_pw = Path("supabase/.temp/db-pw.txt").read_text().strip()
    env["SUPABASE_DB_PASSWORD"] = db_pw

    try:
        result = subprocess.run(
            ["npx", "supabase", "db", "query", "--linked", sql],
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )

        if result.returncode != 0:
            print(f" Query failed: {result.stderr}", file=sys.stderr)
            return []

        # Parse JSON from output
        output = result.stdout
        if '{"rows"' in output:
            data = json.loads(output[output.index('{"rows"') :])
            return data.get("rows", [])
    except Exception as e:
        print(f" Error querying {tj_code}: {e}", file=sys.stderr)

    return []


def run_pje_skiptrace(tj_code: str, limit: int):
    """Dispara o skip-trace do TJ no scraper certo p/ o SISTEMA dele.

    RN (pje) roda direto (sessão persistente, sem CDP). eproc/Projudi precisam de
    login A3 no Chrome real via CDP -> não dá p/ orquestrar headless aqui; o script
    imprime o comando exato. TJs inviáveis (PB Cloudflare, SP e-SAJ) são pulados.
    """
    info = TRIBUNALS[tj_code]

    if info.get("viable") is False:
        print(f"SKIP {info['name']} ({tj_code.upper()}) inviavel: {info['note']}", file=sys.stderr)
        return 0

    if tj_code == "rn":
        print(f"\nTRACE {info['name']} ({info['state']}) -> pje_rn_skiptrace.py (limit {limit})", flush=True)
        return subprocess.run(
            ["python", "-u", "tools/pje_rn_skiptrace.py", "--limit", str(limit)],
            timeout=3600,
        ).returncode

    # eproc (RS/SC) / Projudi (PR): exigem A3 via CDP (login manual) -> não orquestrável aqui.
    print(f"\nMANUAL {info['name']} ({info['state']}) usa '{info['system']}' e precisa de login A3 via CDP:")
    print(f"  1) .\\tools\\chrome-cdp.ps1 -Tj {tj_code}   (Chrome real; logue o A3)")
    print(f"  2) python tools/{info['scraper']} --limit {limit}")
    print(f"     ({info['note']})", flush=True)
    return 2


def main():
    parser = argparse.ArgumentParser(
        description="Multi-state PJe skip-trace (RN, PB, PR, RS, SC)"
    )
    parser.add_argument(
        "--limit", type=int, default=100, help="Limite de sócios por TJ (default: 100)"
    )
    parser.add_argument(
        "--tj",
        type=str,
        default="rn",
        help="TJs a processar, comma-separated (default: rn). Ex: rn,pb,pr",
    )
    parser.add_argument(
        "--check", action="store_true", help="Verificar acessibilidade de todos os TJs"
    )

    args = parser.parse_args()

    if args.check:
        print("CHECK Acessibilidade + sistema de cada Tribunal...\n")
        viab_lbl = {True: "viavel", False: "inviavel", None: "a confirmar"}
        for tj_code, info in TRIBUNALS.items():
            r = check_tribunal_access(tj_code)
            if not r["reachable"]:
                net = "DNS/down"
            elif r.get("cloudflare"):
                net = f"CF-BLOCK {r['status']}"
            else:
                net = f"up {r['status']}" + (" (CF)" if r.get("cf_present") else "")
            print(
                f"{info['name']:6} {info['state']:2} sys={info['system']:8} "
                f"net={net:13} {viab_lbl[info.get('viable')]:11} -> {info['scraper']}"
            )
            if r.get("error"):
                print(f"       net error: {r['error']}", file=sys.stderr)
        print("\nLegenda: 403/405 a GET na raiz e NORMAL no PJe/eproc (nao e bloqueio). "
              "'(CF)' = Cloudflare na frente mas PASSA (ok com browser+A3). "
              "CF-BLOCK = desafio/403 do Cloudflare. Rodar cada um exige login A3.")
        return 0

    # Parsear TJs
    tj_list = [tj.strip().lower() for tj in args.tj.split(",")]
    invalid = [tj for tj in tj_list if tj not in TRIBUNALS]

    if invalid:
        print(f" TJs inválidos: {', '.join(invalid)}", file=sys.stderr)
        print(f"   Opções: {', '.join(TRIBUNALS.keys())}", file=sys.stderr)
        return 1

    print(f"═══════════════════════════════════════════════════════════════")
    print(f"PJe Multi-State Skip-Trace")
    print(f"═══════════════════════════════════════════════════════════════")
    print(f"TJs: {', '.join(tj.upper() for tj in tj_list)}")
    print(f"Limit: {args.limit} sócios por TJ")
    print(f"═══════════════════════════════════════════════════════════════\n")

    # Rodar em série (um TJ por vez)
    total_enriched = 0
    for tj_code in tj_list:
        rc = run_pje_skiptrace(tj_code, args.limit)
        if rc != 0:
            print(f"  {tj_code.upper()} terminou com erro (code={rc})", file=sys.stderr)
        total_enriched += 1  # simplificado; valor real vem do log

    print(f"\n Processamento concluído ({len(tj_list)} TJs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
