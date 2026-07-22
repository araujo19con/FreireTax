# -*- coding: utf-8 -*-
"""Baixa o dump mensal de CNPJ da Receita (layout NOVO de 2026: share Nextcloud).

Desde jan/2026 os arquivos saíram de dadosabertos.rfb.gov.br e vivem num share
Nextcloud em arquivos.receitafederal.gov.br — o acesso é WebDAV com o token do
share como usuário e senha vazia. As URLs antigas dão 404/timeout.

USO:
  python tools/rfb_download.py --mes 2026-07 --dest D:\rfb-dump
  python tools/rfb_download.py --mes 2026-07 --dest C:\rfb-dump --so Empresas,Socios

Retomável: baixa em .part e renomeia no fim; arquivo completo é pulado.
"""
import os
import sys
import base64
import argparse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

TOKEN = "YggdBLfdninEJX9"          # share público oficial da RFB
BASE = "https://arquivos.receitafederal.gov.br/public.php/webdav"
AUTH = base64.b64encode(f"{TOKEN}:".encode()).decode()

GRUPOS = {
    "Empresas": [f"Empresas{i}.zip" for i in range(10)],
    "Estabelecimentos": [f"Estabelecimentos{i}.zip" for i in range(10)],
    "Socios": [f"Socios{i}.zip" for i in range(10)],
    "Simples": ["Simples.zip"],
    "Apoio": ["Municipios.zip", "Naturezas.zip", "Qualificacoes.zip", "Cnaes.zip"],
}


def baixar(mes, dest, nome):
    alvo = os.path.join(dest, nome)
    part = alvo + ".part"
    if os.path.exists(alvo):
        return f"pulado (já existe): {nome}"
    req = urllib.request.Request(f"{BASE}/{mes}/{nome}",
                                 headers={"Authorization": f"Basic {AUTH}"})
    ja = os.path.getsize(part) if os.path.exists(part) else 0
    if ja:
        req.add_header("Range", f"bytes={ja}-")
    modo = "ab" if ja else "wb"
    try:
        with urllib.request.urlopen(req, timeout=120) as r, open(part, modo) as fh:
            total = int(r.headers.get("Content-Length", 0)) + ja
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
        os.replace(part, alvo)
        mb = os.path.getsize(alvo) / (1 << 20)
        return f"ok: {nome} ({mb:.0f} MB)"
    except Exception as e:
        return f"ERRO: {nome}: {str(e)[:90]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mes", required=True, help="pasta ano-mes, ex. 2026-07")
    ap.add_argument("--dest", required=True)
    ap.add_argument("--so", help="grupos separados por vírgula "
                                 f"(default todos: {','.join(GRUPOS)})")
    ap.add_argument("--paralelo", type=int, default=3,
                    help="downloads simultâneos (o servidor da RFB é modesto)")
    a = ap.parse_args()
    os.makedirs(a.dest, exist_ok=True)
    grupos = [g.strip() for g in (a.so or ",".join(GRUPOS)).split(",")]
    arquivos = [f for g in grupos for f in GRUPOS.get(g, [])]
    print(f"{len(arquivos)} arquivo(s) de {a.mes} -> {a.dest}")
    with ThreadPoolExecutor(max_workers=a.paralelo) as ex:
        for res in ex.map(lambda n: baixar(a.mes, a.dest, n), arquivos):
            print("  " + res)
    faltando = [f for f in arquivos if not os.path.exists(os.path.join(a.dest, f))]
    if faltando:
        print(f"\nFALTARAM {len(faltando)}: {faltando} — rode de novo (retoma do .part)")
        sys.exit(1)
    print("\ncompleto.")


if __name__ == "__main__":
    main()
