# -*- coding: utf-8 -*-
"""Objetos tributários que aparecem no PJe mas NÃO existem no catálogo.

A varredura marca esses processos com acao_id nulo e o log diz "tributário, mas
fora do catálogo". Cada um é candidato a TESE NOVA — foi assim que entraram
PAT, aprendizes e creditamento de ICMS-ST. Este relatório agrupa por assunto e
ordena por frequência: o que se repete em várias empresas é oportunidade de
produto, não ruído.

USO:
  . tools\\pje-env.local.ps1
  python tools/pje_teses_a_mapear.py
"""
import os
import re
import sys
import json
import urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import pje_teses_empresa as T  # noqa: E402

H = {"apikey": T.SERVICE_KEY, "Authorization": f"Bearer {T.SERVICE_KEY}"}
get = (lambda p: json.load(urllib.request.urlopen(
    urllib.request.Request(f"{T.SUPABASE_URL}/rest/v1/{p}", headers=H))))


def folha(assunto):
    """Último nível do assunto hierárquico do CNJ — é o objeto de fato.
    'DIREITO TRIBUTÁRIO|Contribuições|...|Salário-Maternidade' -> Salário-Maternidade
    """
    a = (assunto or "").split(" DIREITO ")[0]
    partes = [p.strip() for p in a.split("|") if p.strip()]
    return partes[-1] if partes else "(sem assunto)"


def main():
    if not T.SUPABASE_URL or not T.SERVICE_KEY:
        sys.exit("ERRO: rode `. tools\\pje-env.local.ps1` antes.")
    rows = get("empresa_processos_tributarios?select=numero,assunto,acao_id,"
               "empresa_id,metadados&acao_id=is.null")
    eids = sorted({r["empresa_id"] for r in rows if r.get("empresa_id")})
    nomes = {}
    for i in range(0, len(eids), 40):
        for e in get("empresas?select=id,nome,razao_social&id=in.("
                     + ",".join(eids[i:i + 40]) + ")"):
            nomes[e["id"]] = (e.get("razao_social") or e.get("nome") or "?").strip()

    grupos = defaultdict(list)
    sugeridas = defaultdict(list)
    for r in rows:
        md = r.get("metadados") or {}
        if md.get("tese_sugerida"):
            sugeridas[md["tese_sugerida"]].append(r)
            continue
        if not T.assunto_tributario(r.get("assunto") or ""):
            continue
        grupos[folha(r.get("assunto"))].append(r)

    print("=" * 74)
    print("OBJETOS TRIBUTÁRIOS FORA DO CATÁLOGO — candidatos a tese nova")
    print("=" * 74)
    if not grupos:
        print("\n(nenhum)")
    for assunto, rs in sorted(grupos.items(), key=lambda kv: -len(kv[1])):
        empresas = {nomes.get(r["empresa_id"], "?") for r in rs}
        print(f"\n▸ {assunto}   —   {len(rs)} processo(s) em {len(empresas)} empresa(s)")
        for r in rs[:4]:
            print(f"    {r['numero']}  ({nomes.get(r['empresa_id'], '?')[:40]})")
        if len(rs) > 4:
            print(f"    ... e mais {len(rs) - 4}")

    if sugeridas:
        print("\n" + "=" * 74)
        print("TESES SUGERIDAS AGUARDANDO REVISÃO (assunto não corroborou)")
        print("=" * 74)
        for tese, rs in sorted(sugeridas.items(), key=lambda kv: -len(kv[1])):
            print(f"\n▸ {tese}   —   {len(rs)} processo(s)")
            for r in rs[:4]:
                print(f"    {r['numero']}  ({nomes.get(r['empresa_id'], '?')[:40]})")

    print(f"\n{len(rows)} processo(s) sem tese cravada · "
          f"{len(grupos)} objeto(s) distinto(s) a mapear")


if __name__ == "__main__":
    main()
