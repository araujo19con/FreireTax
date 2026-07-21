# -*- coding: utf-8 -*-
"""Escolhe as proximas N empresas do RN ainda NAO varridas (sem processo gravado),
priorizando as que tem elegibilidade/prospeccao (valor comercial)."""
import sys, json, urllib.request, argparse
sys.path.insert(0, r"c:\Users\Gabriel\Desktop\FREIRETAX\tax-trakker\tools")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import importlib
T = importlib.import_module("pje_teses_empresa")
H = {"apikey": T.SERVICE_KEY, "Authorization": "Bearer " + T.SERVICE_KEY}
get = lambda p: json.load(urllib.request.urlopen(
    urllib.request.Request(T.SUPABASE_URL + "/rest/v1/" + p, headers=H)))

ap = argparse.ArgumentParser()
ap.add_argument("-n", type=int, default=3)
a = ap.parse_args()

ja = {r["empresa_id"] for r in get("empresa_processos_tributarios?select=empresa_id")}
# empresa SEM candidato nao deixa linha em empresa_processos_tributarios — sem o
# carimbo ela voltava na fila todo lote (M. Dias Branco rodou 4x a toa)
ja |= {e["id"] for e in get("empresas?select=id&teses_analisada_em=not.is.null&limit=2000")}
# empresas do RN com CNPJ, ativas, ainda nao varridas
emps = get("empresas?select=id,nome,razao_social,cnpj,uf,situacao_cadastral,capital_social,"
           "porte,faturamento_anual,quantidade_funcionarios"
           "&uf=eq.RN&cnpj=not.is.null&limit=1000")
com_eleg = {r["empresa_id"] for r in get("elegibilidade?select=empresa_id")}
# VEICULO SOCIETARIO nao litiga: SPE, holding e participacoes existem pra deter
# ativo, nao pra operar. O ciclo 12 gastou 3 vagas em SPE de energia com ZERO
# processo. Nao ha folha, nao ha ICMS, nao ha tese.
SEM_OPERACAO = ("SPE ", " SPE", "HOLDING", "PARTICIPACOES", "PARTICIPACAO",
                "FUNDO DE INVESTIMENTO", "CONDOMINIO", "ESPOLIO")


def _e_veiculo(e):
    n = ((e.get("razao_social") or "") + " " + (e.get("nome") or "")).upper()
    return any(k in n for k in SEM_OPERACAO)


cand = [e for e in emps
        if e["id"] not in ja
        and (e.get("situacao_cadastral") or "ATIVA") == "ATIVA"
        and len("".join(ch for ch in (e.get("cnpj") or "") if ch.isdigit())) == 14
        and not _e_veiculo(e)]
# QUEM OPERA PRIMEIRO: folha e faturamento sao o sinal de que ha materia
# tributaria (CPP, RAT, PIS/COFINS). Capital social sozinho engana — SPE tem
# capital alto e nenhuma operacao.
cand.sort(key=lambda e: (-(e.get("quantidade_funcionarios") or 0),
                         -(e.get("faturamento_anual") or 0),
                         -(e.get("capital_social") or 0),
                         e["id"] not in com_eleg))
sel = cand[:a.n]
print(f"{len(cand)} candidata(s) no RN sem varredura; escolhidas {len(sel)}:\n")
for e in sel:
    print(f"  {e['cnpj']}  {(e.get('razao_social') or e.get('nome') or '')[:52]}"
          f"{'  [tem elegibilidade]' if e['id'] in com_eleg else ''}")
print("\nCNPJS=" + ",".join(e["cnpj"] for e in sel))
