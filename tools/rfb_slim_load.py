# -*- coding: utf-8 -*-
"""Popula rfb_estabelecimentos_busca (busca de CNPJ por nome na UI) direto dos
ZIPS do dump — sem extrair os ~25 GB que o import-rfb-slim.mjs exige.

A tabela estava VAZIA (0 linhas): o botão "Buscar pelo nome" retornava vazio
para todo mundo, silenciosamente. Default RN,PB como documentado no
README-import-rfb.md — a tabela cresce ~40 MB por UF grande e o banco é o
free tier de 500 MB; não subir as 6 UFs do TRF5 sem checar o espaço.

USO:
  . tools\\pje-env.local.ps1
  python tools/rfb_slim_load.py --dump C:\\rfb-dump --ufs RN,PB --truncate
"""
import os
import sys
import json
import glob
import time
import argparse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rfb_capital_trf5 import linhas_zip, _lookup  # noqa: E402  (mesmo parsing)


def _sb(url, key, path, method="GET", body=None, prefer="return=minimal"):
    req = urllib.request.Request(f"{url}/rest/v1/{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": key, "Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json",
                                          "Prefer": prefer})
    t = urllib.request.urlopen(req, timeout=180).read().decode()
    return json.loads(t) if t.strip() else []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True)
    ap.add_argument("--ufs", default="RN,PB")
    ap.add_argument("--truncate", action="store_true")
    ap.add_argument("--batch", type=int, default=1000)
    a = ap.parse_args()
    URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not URL or not KEY:
        sys.exit("ERRO: rode `. tools\\pje-env.local.ps1` antes.")
    ufs = {u.strip().upper() for u in a.ufs.split(",")}
    t0 = time.time()

    municipios = _lookup(a.dump, "Municipios.zip")
    print(f"[1/3] Estabelecimentos*.zip — ATIVAS em {'/'.join(sorted(ufs))}")
    ests = {}
    for cam in sorted(glob.glob(os.path.join(a.dump, "Estabelecimentos*.zip"))):
        print("   ", os.path.basename(cam))
        for row in linhas_zip(cam):
            if len(row) < 21 or row[5].strip() != "02":
                continue
            if row[19].strip().upper() not in ufs:
                continue
            basico = row[0].strip()
            ests[basico + row[1].strip() + row[2].strip()] = {
                "basico": basico,
                "nome_fantasia": row[4].strip() or None,
                "uf": row[19].strip().upper(),
                "municipio": municipios.get(row[20].strip()),
            }
    print(f"    {len(ests):,} estabelecimentos ativos")

    print("[2/3] Empresas*.zip — razões sociais")
    precisa = {e["basico"] for e in ests.values()}
    razoes = {}
    for cam in sorted(glob.glob(os.path.join(a.dump, "Empresas*.zip"))):
        print("   ", os.path.basename(cam))
        for row in linhas_zip(cam):
            if len(row) >= 2 and row[0].strip() in precisa:
                razoes[row[0].strip()] = row[1].strip()

    print("[3/3] upsert")
    if a.truncate:
        _sb(URL, KEY, "rfb_estabelecimentos_busca?cnpj=neq.__nunca__", "DELETE")
        print("    tabela truncada")
    linhas = [{"cnpj": cnpj, "razao_social": razoes.get(e["basico"], ""),
               "nome_fantasia": e["nome_fantasia"], "uf": e["uf"],
               "municipio": e["municipio"]}
              for cnpj, e in ests.items() if razoes.get(e["basico"])]
    for i in range(0, len(linhas), a.batch):
        _sb(URL, KEY, "rfb_estabelecimentos_busca?on_conflict=cnpj", "POST",
            linhas[i:i + a.batch],
            prefer="return=minimal,resolution=merge-duplicates")
        if (i // a.batch) % 20 == 0:
            print(f"    {min(i + a.batch, len(linhas)):,}/{len(linhas):,}")
    print(f"\nFEITO: {len(linhas):,} linhas em {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
