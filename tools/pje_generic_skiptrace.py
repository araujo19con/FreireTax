#!/usr/bin/env python3
"""Generic PJe skip-trace para múltiplos TJs (RN, PB, PR, RS, SC).

Mesma lógica do pje_rn_skiptrace.py, mas parametrizado por TJ.
Suporta qualquer TJ que siga a estrutura PJe padrão do CNJ.

Uso:
  python pje_generic_skiptrace.py --tj rn --limit 150
  python pje_generic_skiptrace.py --tj pr --limit 150
  python pje_generic_skiptrace.py --tj pb --limit 150
"""

import os
import sys
import json
import time
import argparse
import re
from pathlib import Path
from datetime import datetime
from playwright.async_api import async_playwright
import asyncio

# Mapa de TJs
TRIBUNALS = {
    "rn": {
        "url": "pje1g.tjrn.jus.br",
        "state": "RN",
        "name": "TJRN",
        "path_consulta": "/pje/seam/resource/rest/pje-legacy/consultarByNome",
    },
    "pb": {
        "url": "pje1g.tjpb.jus.br",
        "state": "PB",
        "name": "TJPB",
        "path_consulta": "/pje/seam/resource/rest/pje-legacy/consultarByNome",
    },
    "pr": {
        "url": "pje.tjpr.jus.br",
        "state": "PR",
        "name": "TJPR",
        "path_consulta": "/pje/seam/resource/rest/pje-legacy/consultarByNome",
    },
    "rs": {
        "url": "pje.tjrs.jus.br",
        "state": "RS",
        "name": "TJRS",
        "path_consulta": "/pje/seam/resource/rest/pje-legacy/consultarByNome",
    },
    "sc": {
        "url": "pje1g.tjsc.jus.br",
        "state": "SC",
        "name": "TJSC",
        "path_consulta": "/pje/seam/resource/rest/pje-legacy/consultarByNome",
    },
}

# Env vars
SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("ERROR: SUPABASE_URL e SERVICE_ROLE_KEY obrigatórios", file=sys.stderr)
    sys.exit(1)


def sb(endpoint: str, method="GET", body=None):
    """Supabase REST API call."""
    import requests

    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = {
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    try:
        if method == "GET":
            r = requests.get(url, headers=headers, timeout=10)
        elif method == "PATCH":
            r = requests.patch(url, headers=headers, json=body, timeout=10)
        elif method == "POST":
            r = requests.post(url, headers=headers, json=body, timeout=10)
        else:
            raise ValueError(f"Método desconhecido: {method}")

        if r.status_code >= 400:
            print(f"[SB] {method} {endpoint} -> {r.status_code}", file=sys.stderr)
            if r.text:
                print(f"     {r.text[:200]}", file=sys.stderr)
            return None

        return r.json() if r.text else None
    except Exception as e:
        print(f"[SB ERROR] {method} {endpoint}: {e}", file=sys.stderr)
        return None


def fetch_targets(tj_code: str, limit: int) -> list:
    """Busca sócios PF do estado que não foram enriquecidos."""
    state = TRIBUNALS[tj_code]["state"]
    marker = f"PJe/{TRIBUNALS[tj_code]['name']}"

    # Query: sócios sem enriquecimento
    q = (
        f"empresa_contatos?select=id,nome,cpf_mascarado,empresa_id&papel=eq.socio"
        f"&empresas.uf=eq.{state}&cpf_mascarado=like.*%2A*"
        f"&observacoes=not.ilike.*{marker}*&limit={limit}&order=nome.asc"
    )

    rows = sb(f"empresa_contatos?select=id,nome,cpf_mascarado,empresa_id,empresas!inner(id,uf)"
              f"&papel=eq.socio&empresas.uf=eq.{state}&limit={limit}")

    if not rows:
        return []

    # Filter: sem marcador PJe/[TJNAME]
    return [r for r in rows if not (r.get("observacoes") or "").find(marker) >= 0]


async def run_browser_session(tj_code: str, limit: int):
    """Abre Playwright, busca nomes, coleta dados."""

    info = TRIBUNALS[tj_code]
    print(f"\n[{tj_code.upper()}] Iniciando sessão Playwright", flush=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)  # headless=False pra você ver o login
        ctx = await browser.new_context()
        page = await ctx.new_page()

        # Navega pro TJ
        url = f"https://{info['url']}/pje/inicio"
        print(f"[{tj_code.upper()}] Abrindo {url}", flush=True)
        await page.goto(url, wait_until="networkidle")

        # Você faz login aqui (interativo)
        print(f"[{tj_code.upper()}] FAÇA LOGIN COM A3 NO BROWSER (30 min de timeout)", flush=True)
        try:
            # Espera até estar logado (busca a página de consulta)
            await page.wait_for_url("**consultar**", timeout=30 * 60 * 1000)  # 30 min
        except Exception as e:
            print(f"[{tj_code.upper()}] Timeout ou erro no login: {e}", file=sys.stderr)
            await browser.close()
            return 0

        print(f"[{tj_code.upper()}] Login detectado! Iniciando consultas.", flush=True)

        # Busca os sócios
        targets = fetch_targets(tj_code, limit)
        print(f"[{tj_code.upper()}] {len(targets)} sócios para consultar", flush=True)

        enriched = 0
        for i, target in enumerate(targets, 1):
            nome = target.get("nome", "").strip()
            if not nome:
                continue

            # Query PJe pelo nome
            print(f"  [{i}/{len(targets)}] {nome}...", end=" ", flush=True)

            # Implementação real aqui seria: chamar API do PJe ou navegar na UI
            # Por agora: stub
            print("(stub)", flush=True)

        await browser.close()
        return enriched


def main():
    parser = argparse.ArgumentParser(description="Generic PJe skip-trace (multi-TJ)")
    parser.add_argument("--tj", default="rn", help="TJ (rn, pb, pr, rs, sc)")
    parser.add_argument("--limit", type=int, default=100, help="Limite de sócios")

    args = parser.parse_args()

    if args.tj not in TRIBUNALS:
        print(f"TJ inválido: {args.tj}", file=sys.stderr)
        return 1

    print(f"═══════════════════════════════════════════════════════════════")
    print(f"PJe Generic Skip-Trace")
    print(f"TJ: {args.tj.upper()} ({TRIBUNALS[args.tj]['state']})")
    print(f"Limit: {args.limit}")
    print(f"═══════════════════════════════════════════════════════════════")

    # Rodar Playwright (async)
    enriched = asyncio.run(run_browser_session(args.tj, args.limit))

    print(f"\n✓ {enriched} sócios enriquecidos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
