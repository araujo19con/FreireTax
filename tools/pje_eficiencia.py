# -*- coding: utf-8 -*-
"""Lê a telemetria da varredura e diz ONDE o tempo foi — e o que atacar.

Fecha o ciclo da auditoria: o scraper cronometra cada fase em
tools/.cache/telemetria.jsonl, este script agrega e aponta o gargalo. Sem isso a
otimização é chute — foi assim que 90s por empresa ficaram escondidos num timeout.

USO:
  python tools/pje_eficiencia.py            # tudo que já foi medido
  python tools/pje_eficiencia.py --ultimas 3   # só as 3 últimas empresas
"""
import os
import sys
import json
import argparse
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TELEMETRIA = os.path.join(ROOT, "tools", ".cache", "telemetria.jsonl")


def pct(vals, p):
    if not vals:
        return 0.0
    v = sorted(vals)
    return v[min(len(v) - 1, int(len(v) * p / 100))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ultimas", type=int, default=0,
                    help="considera só as N últimas empresas medidas")
    a = ap.parse_args()
    if not os.path.exists(TELEMETRIA):
        sys.exit("sem telemetria ainda — rode o scraper uma vez.")
    linhas = []
    with open(TELEMETRIA, encoding="utf-8") as fh:
        for ln in fh:
            try:
                linhas.append(json.loads(ln))
            except Exception:
                pass
    if a.ultimas:
        emp = [x for x in linhas if x["fase"] == "empresa"][-a.ultimas:]
        if emp:
            corte = emp[0]["ts"]
            linhas = [x for x in linhas if x["ts"] >= corte]

    por_fase = defaultdict(list)
    for x in linhas:
        por_fase[x["fase"]].append(x)

    empresas = por_fase.get("empresa", [])
    total = sum(x["seg"] for x in empresas)
    print("=" * 74)
    print(f"EFICIÊNCIA — {len(empresas)} empresa(s) medida(s) · "
          f"total {total:.0f}s ({total/60:.1f} min)")
    if empresas:
        print(f"por empresa: média {total/len(empresas):.0f}s · "
              f"p50 {pct([x['seg'] for x in empresas], 50):.0f}s · "
              f"pior {max(x['seg'] for x in empresas):.0f}s")
    print("=" * 74)

    print(f"\n{'fase':<12} {'n':>4} {'soma':>8} {'média':>8} {'p95':>8} {'% do total':>11}")
    print("-" * 60)
    ordem = sorted((f for f in por_fase if f != "empresa"),
                   key=lambda f: -sum(x["seg"] for x in por_fase[f]))
    for f in ordem:
        vs = [x["seg"] for x in por_fase[f]]
        soma = sum(vs)
        frac = (soma / total * 100) if total else 0
        print(f"{f:<12} {len(vs):>4} {soma:>7.0f}s {soma/len(vs):>7.1f}s "
              f"{pct(vs, 95):>7.1f}s {frac:>10.0f}%")

    # --- o que dói: as chamadas individuais mais caras ---
    caras = sorted((x for x in linhas if x["fase"] != "empresa"),
                   key=lambda x: -x["seg"])[:8]
    if caras:
        print("\nCHAMADAS MAIS CARAS")
        for x in caras:
            alvo = x.get("proc") or x.get("grau") or ""
            extra = f" via={x['via']}" if x.get("via") else ""
            print(f"  {x['seg']:>6.1f}s  {x['fase']:<9} {alvo}{extra}"
                  f"{'  [ERRO]' if x.get('erro') else ''}")

    # --- diagnóstico automático ---
    print("\nDIAGNÓSTICO")
    achou = False
    pet = por_fase.get("peticao", [])
    if pet:
        vazias = [x for x in pet if x.get("erro")]
        soma = sum(x["seg"] for x in pet)
        if total and soma / total > 0.5:
            print(f"  · a PETIÇÃO consome {soma/total*100:.0f}% do tempo "
                  f"({len(pet)} peças, {soma/len(pet):.0f}s cada). É o alvo nº 1.")
            achou = True
        if vazias:
            print(f"  · {len(vazias)} petição(ões) terminaram em erro — tempo gasto sem "
                  "resultado; considere abortar mais cedo.")
            achou = True
    bus = por_fase.get("busca", [])
    if bus:
        lentas = [x for x in bus if x["seg"] > 45]
        if lentas:
            print(f"  · {len(lentas)} busca(s) acima de 45s — o PJe 1.x é lento, mas "
                  "verifique se não está esperando além do contador.")
            achou = True
    fm = por_fase.get("form", [])
    if fm:
        soma = sum(x["seg"] for x in fm)
        if total and soma / total > 0.15:
            print(f"  · re-garantir o FORM custa {soma/total*100:.0f}% do tempo "
                  f"({len(fm)}x). Reaproveitar a aba entre empresas evita isso.")
            achou = True
    dj = por_fase.get("datajud", [])
    if dj:
        soma = sum(x["seg"] for x in dj)
        if total and soma / total > 0.1:
            print(f"  · DataJud custa {soma/total*100:.0f}% ({len(dj)} chamadas, "
                  f"{soma/len(dj):.1f}s cada) — é HTTP puro, dá pra paralelizar.")
            achou = True
    if not achou:
        print("  · nada dominante; o tempo está distribuído.")


if __name__ == "__main__":
    main()
