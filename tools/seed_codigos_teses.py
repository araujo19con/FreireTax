# -*- coding: utf-8 -*-
"""Semeia acoes_tributarias.codigo (contrato ESTÁVEL da detecção) casando cada
tese do catálogo, pelo NOME atual, ao codigo definido em pje_teses_empresa.TESE_CODIGO.

É o ÚNICO passo que usa o nome para achar o codigo — depois disso a detecção casa
só por codigo (renomear a tese não quebra mais). Idempotente: não sobrescreve
codigo já preenchido. DRY-RUN por padrão; use --apply para gravar.

Requer env SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (mesmo do pje_teses_empresa.py;
carregue tools/pje-env.local.ps1 antes).

  python tools/seed_codigos_teses.py           # preview (não grava)
  python tools/seed_codigos_teses.py --apply    # grava os codigos faltantes
"""
import sys, io, os, argparse
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pje_teses_empresa as M  # reusa sb/sb_patch/_norm/TESE_CODIGO/tese_codigo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="grava (default é dry-run)")
    args = ap.parse_args()
    if not (M.SUPABASE_URL and M.SERVICE_KEY):
        sys.exit("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente "
                 "(carregue tools/pje-env.local.ps1).")

    rows = M.sb("acoes_tributarias?select=id,nome,codigo,status")
    # codigo desejado por linha (pelo nome atual)
    want = {r["id"]: M.tese_codigo(r["nome"]) for r in rows}

    # colisão: 2+ linhas do catálogo mapeando pro MESMO codigo (nomes duplicados)
    por_codigo = {}
    for r in rows:
        c = want[r["id"]]
        if c:
            por_codigo.setdefault(c, []).append(r["nome"])
    colisoes = {c: ns for c, ns in por_codigo.items() if len(ns) > 1}

    # regra morta: codigo em TESE_CODIGO que nenhuma linha do catálogo produz
    achados = set(por_codigo)
    orfas = sorted(c for c in set(M.TESE_CODIGO.values()) if c not in achados)

    a_gravar, ja_ok, conflito, sem_regra = [], [], [], []
    for r in rows:
        c = want[r["id"]]
        if not c:
            sem_regra.append(r["nome"])           # tese sem regra de detecção (ok, fica NULL)
            continue
        if c in colisoes:
            continue                               # trata no relatório de colisão
        atual = (r.get("codigo") or "").strip()
        if atual == c:
            ja_ok.append(r["nome"])
        elif atual:
            conflito.append((r["nome"], atual, c))  # já tem OUTRO codigo — não sobrescreve
        else:
            a_gravar.append(r)

    print(f"Catálogo: {len(rows)} teses | com regra de detecção: {sum(1 for v in want.values() if v)}")
    print(f"  já com codigo certo: {len(ja_ok)}")
    print(f"  a gravar (codigo faltante): {len(a_gravar)}")
    for r in a_gravar:
        print(f"    + {want[r['id']]:38s} <- {r['nome']}")
    if conflito:
        print(f"  [!] {len(conflito)} com codigo DIFERENTE (NÃO sobrescrevo):")
        for nome, atual, c in conflito:
            print(f"      {nome}: tem '{atual}', esperado '{c}'")
    if colisoes:
        print(f"  [ERRO] {len(colisoes)} codigo(s) com NOME DUPLICADO no catálogo "
              f"(violaria UNIQUE — corrija os nomes antes):")
        for c, ns in colisoes.items():
            print(f"      {c}: {ns}")
    if orfas:
        print(f"  [AVISO] {len(orfas)} regra(s) de detecção SEM tese no catálogo (regra morta): {orfas}")
    if sem_regra:
        print(f"  ({len(sem_regra)} tese(s) do catálogo sem regra de detecção — ficam sem codigo, ok)")

    if not args.apply:
        print("\nDRY-RUN. Rode com --apply para gravar os codigos faltantes.")
        return
    if colisoes:
        sys.exit("\nAbortado: resolva os nomes duplicados (colisão de codigo) antes de gravar.")
    gravados = 0
    for r in a_gravar:
        M.sb_patch(f"acoes_tributarias?id=eq.{r['id']}", {"codigo": want[r["id"]]})
        gravados += 1
    print(f"\nOK — {gravados} codigo(s) gravado(s).")


if __name__ == "__main__":
    main()
