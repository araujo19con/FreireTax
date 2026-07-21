# -*- coding: utf-8 -*-
"""Reclassifica os processos JÁ COLHIDOS — sem abrir o PJe, sem A3, em segundos.

POR QUE EXISTE: o catálogo cresce toda vez que o escritório confirma o objeto de
uma peça, e cada tese nova pode mudar a leitura de processos antigos. Refazer a
varredura no PJe pra isso custa ~10 min POR EMPRESA e depende do A3 e do limite
diário de abertura de autos. Mas os dois insumos da decisão já estão salvos:
  - o ASSUNTO da fonte, em empresa_processos_tributarios.assunto
  - a PETIÇÃO INICIAL, em tools/.cache/peticoes/<numero>.json (imutável)
Então reclassificar é trabalho local.

SEGURANÇA: nunca mexe em processo cujo objeto foi CONFIRMADO PELO ESCRITÓRIO
(metadados.origem). A palavra do advogado vence a do classificador, sempre.

USO:
  . tools\\pje-env.local.ps1
  python tools/pje_reclassificar.py                # simulação (não grava)
  python tools/pje_reclassificar.py --gravar       # aplica
  python tools/pje_reclassificar.py --cnpj 01.611.866/0001-00
"""
import os
import re
import sys
import json
import argparse
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
import pje_teses_empresa as T  # noqa: E402

H = {"apikey": T.SERVICE_KEY, "Authorization": f"Bearer {T.SERVICE_KEY}",
     "Content-Type": "application/json"}
# marca de objeto ditado pelo escritório — intocável
CONFIRMADO = "confirmado pelo escritorio"


def _req(path, method="GET", body=None):
    r = urllib.request.Request(f"{T.SUPABASE_URL}/rest/v1/{path}", method=method,
                               data=json.dumps(body).encode() if body is not None else None,
                               headers={**H, "Prefer": "return=representation"})
    t = urllib.request.urlopen(r).read().decode()
    return json.loads(t) if t.strip() else []


def _peticao_cacheada(numero):
    try:
        with open(T._cache_path(numero), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cnpj", help="limita a uma empresa")
    ap.add_argument("--gravar", action="store_true",
                    help="aplica as mudanças (sem isto, só simula)")
    a = ap.parse_args()
    if not T.SUPABASE_URL or not T.SERVICE_KEY:
        sys.exit("ERRO: rode `. tools\\pje-env.local.ps1` antes.")

    acoes = _req("acoes_tributarias?select=id,nome,status")
    ativas = {x["id"]: x["nome"].strip() for x in acoes if x.get("status") == "Ativa"}
    nome_por_id = {x["id"]: x["nome"].strip() for x in acoes}
    id_por_nome = {T._norm(v): k for k, v in nome_por_id.items()}
    catalogo_norm = {T._norm(v) for v in ativas.values()}

    filtro = ""
    if a.cnpj:
        emps = _req("empresas?select=id,nome,razao_social&cnpj=eq."
                    + urllib.parse.quote(a.cnpj))
        if not emps:
            sys.exit(f"empresa não encontrada: {a.cnpj}")
        filtro = f"&empresa_id=eq.{emps[0]['id']}"
    rows = _req("empresa_processos_tributarios?select=id,numero,classe,assunto,acao_id,"
                "empresa_id,metadados" + filtro + "&order=numero")
    eids = sorted({r["empresa_id"] for r in rows})
    emp_nome = {}
    for i in range(0, len(eids), 40):
        for e in _req("empresas?select=id,nome,razao_social&id=in.("
                      + ",".join(eids[i:i + 40]) + ")"):
            emp_nome[e["id"]] = (e.get("razao_social") or e.get("nome") or "?").strip()

    print(f"{len(rows)} processo(s) | catálogo: {len(ativas)} teses ativas"
          f"{'' if a.gravar else '  [SIMULAÇÃO — nada será gravado]'}\n")
    mudou = intocados = com_peticao = 0
    for r in rows:
        md = r.get("metadados") or {}
        if CONFIRMADO in T._norm(json.dumps(md, ensure_ascii=False)).lower():
            intocados += 1
            continue
        cache = _peticao_cacheada(r["numero"])
        peticao = cache.get("peticao", "")
        # só usa a petição se ela for MESMO a peça (o cache antigo tinha anexo)
        if peticao and not T.peticao_valida(peticao):
            peticao = ""
        if peticao:
            com_peticao += 1
        assunto = r.get("assunto") or cache.get("assunto") or ""
        # NUNCA rebaixar por falta de evidência: quem já tem tese cravada foi
        # classificado com a petição em mãos. Se ela não está no cache agora, isso
        # não é prova de erro — é só ausência. Sem petição, este passe só ACRESCENTA
        # (processo ainda sem tese); com petição, pode corrigir.
        if r["acao_id"] and not peticao:
            continue
        if not T.assunto_tributario(assunto) and not peticao:
            continue
        tese, conf = T.classificar_tese(assunto, r.get("classe") or "",
                                        catalogo_norm, peticao)
        novo_id = id_por_nome.get(T._norm(tese)) if tese else None
        corrob = T.assunto_corrobora(tese, assunto) if tese else False
        # mesma trava do fluxo normal: sem corroboração vira sugestão, não crava
        alvo = novo_id if (novo_id and corrob) else None
        if alvo == r["acao_id"]:
            continue
        de = nome_por_id.get(r["acao_id"], "(sem tese)")
        para = (nome_por_id.get(alvo) if alvo
                else (f"SUGESTÃO: {tese}" if tese else "(sem tese)"))
        print(f"  {emp_nome.get(r['empresa_id'], '?')[:34]:<34} {r['numero']}")
        print(f"      de:   {de}")
        print(f"      para: {para}   "
              f"[{'petição' if peticao else 'assunto'}{'' if corrob else ', sem corroboração'}]")
        mudou += 1
        if a.gravar:
            novo_md = dict(md)
            novo_md.pop("tese_sugerida", None)
            if alvo:
                novo_md["origem"] = "reclassificado offline"
            elif tese:
                novo_md["tese_sugerida"] = tese
            _req(f"empresa_processos_tributarios?id=eq.{r['id']}", "PATCH",
                 {"acao_id": alvo, "metadados": novo_md})

    print(f"\n{mudou} mudança(s) · {com_peticao} com petição válida em cache · "
          f"{intocados} intocado(s) (objeto confirmado pelo escritório)")
    if mudou and not a.gravar:
        print("\nrode de novo com --gravar para aplicar.")


if __name__ == "__main__":
    main()
