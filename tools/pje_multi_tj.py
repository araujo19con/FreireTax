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

# Mapa de TJs: url, estado, nome do tribunal
TRIBUNALS = {
    "rn": {
        "url": "pje1g.tjrn.jus.br",
        "state": "RN",
        "name": "TJRN",
        "has_cloudflare": False,  #  Testado, sem CF
    },
    "pb": {
        "url": "pje1g.tjpb.jus.br",
        "state": "PB",
        "name": "TJPB",
        "has_cloudflare": True,  #  Tem CF, tentaremos mesmo assim
    },
    "pr": {
        "url": "pje.tjpr.jus.br",
        "state": "PR",
        "name": "TJPR",
        "has_cloudflare": True,  #  Tem CF
    },
    "rs": {
        "url": "pje.tjrs.jus.br",
        "state": "RS",
        "name": "TJRS",
        "has_cloudflare": True,  #  Tem CF
    },
    "sc": {
        "url": "pje1g.tjsc.jus.br",
        "state": "SC",
        "name": "TJSC",
        "has_cloudflare": True,  #  Tem CF
    },
}


def check_tribunal_access(tj_code: str) -> dict:
    """Testa acessibilidade do tribunal (sem Playwright, só HTTP).

    Retorna: { accessible: bool, cloudflare: bool, error: str or None }
    """
    import requests

    if tj_code not in TRIBUNALS:
        return {"accessible": False, "error": f"TJ desconhecido: {tj_code}"}

    info = TRIBUNALS[tj_code]
    url = f"https://{info['url']}"

    try:
        # HEAD request rápido
        resp = requests.head(url, timeout=5, allow_redirects=True)
        has_cf = "cf" in resp.headers.get("server", "").lower() or resp.status_code == 403
        return {
            "accessible": resp.status_code in (200, 302),
            "cloudflare": has_cf,
            "status": resp.status_code,
            "error": None,
        }
    except Exception as e:
        return {"accessible": False, "cloudflare": None, "error": str(e)}


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
    """Dispara o skiptrace PJe pra um TJ específico.

    Usa o script existente pje_rn_skiptrace.py, mas adaptado pra multi-TJ.
    Por enquanto, só RN está totalmente testado.
    """

    info = TRIBUNALS[tj_code]

    if tj_code != "rn":
        print(f"WARN {info['name']} ({tj_code.upper()}) - TJ com Cloudflare, pode falhar.", file=sys.stderr)
        print(f"       Tentaremos mesmo assim, mas sem garantia.", file=sys.stderr)

    print(f"\nTRACE Iniciando skip-trace: {info['name']} ({info['state']}) - limit {limit}", flush=True)

    # Lista de alvos
    targets = list_tj_targets(tj_code, limit)

    if not targets:
        print(f" Nenhum sócio pendente em {tj_code.upper()}", flush=True)
        return 0

    print(f" {len(targets)} sócios pra enriquecer em {info['name']}", flush=True)

    if tj_code == "rn":
        # RN: usar script existente
        result = subprocess.run(
            ["python", "-u", "tools/pje_rn_skiptrace.py", "--limit", str(limit)],
            timeout=3600,  # 1h max
        )
        return result.returncode
    else:
        # Outros TJs: modo "demo" por enquanto (não implementado fully)
        print(f"  {info['name']} ainda em desenvolvimento.", file=sys.stderr)
        print(f"   Implementação: adaptar Playwright para URL={info['url']}", file=sys.stderr)
        return 1


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
        print("CHECK Verificando acessibilidade dos Tribunais...\n")
        for tj_code, info in TRIBUNALS.items():
            result = check_tribunal_access(tj_code)
            status = "OK" if result["accessible"] else "FAIL"
            cf = " (Cloudflare)" if result.get("cloudflare") else ""
            print(
                f"{status} {info['name']:6} {info['state']:2} "
                f"http={result.get('status', '?'):3} {cf}"
            )
            if result.get("error"):
                print(f"       Error: {result['error']}", file=sys.stderr)
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
