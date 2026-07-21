# -*- coding: utf-8 -*-
"""Compara ConsultaProcesso x ConsultaProcessoTerceiros no PJe 2.x FEDERAL (TRF5).

POR QUE: no PJe 1.x descobrimos que `ConsultaProcesso/listView.seam` só devolve
processos em que o ADVOGADO LOGADO atua (Dois A Engenharia: 1 em vez de 6). O
probe HTTP mostrou que `ConsultaProcessoTerceiros` também EXISTE no 2.x federal
(HTTP 200 nos dois hosts; caminho inventado dá 404), então o 2.x provavelmente
tem a MESMA limitação — e tudo que varremos por lá pode estar incompleto.

Este script não altera nada: só conta os resultados das duas telas pro mesmo CNPJ.

USO (com o Chrome REAL já aberto e A3 do TRF5 logado):
  . tools\\pje-env.local.ps1
  python tools/pje_probe_terceiros_2x.py --cnpj 01.611.866/0001-00 --port 9223
"""
import re
import time
import argparse
from playwright.sync_api import sync_playwright

HOST = "https://pje1g.trf5.jus.br"
TELAS = {
    "ConsultaProcesso        ": "/pje/Processo/ConsultaProcesso/listView.seam",
    "ConsultaProcessoTerceiros": "/pje/Processo/ConsultaProcessoTerceiros/listView.seam",
}
RE_PROC = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
# o campo de CNPJ muda de nome entre as duas telas
SEL_CNPJ = ("input[id$=':documentoParte'], input[id*='documentoParte'], "
            "input[id*='consultaProcessoTerceirosListCNPJ'], "
            "input[id*='cpfCpnjCNPJ'], input[id*='Cnpj'], input[id*='CNPJ']")


def _contador(pg):
    """'Foram encontrados: N resultados' — fim de busca confiável no PJe."""
    try:
        t = pg.evaluate("() => (document.body ? document.body.innerText : '')") or ""
    except Exception:
        return None
    m = re.search(r"Foram encontrados[:\s]*(\d+)", t, re.I)
    return int(m.group(1)) if m else None


def sondar(ctx, caminho, cnpj):
    pg = ctx.new_page()
    try:
        pg.goto(HOST + caminho, wait_until="domcontentloaded", timeout=90000)
        pg.wait_for_timeout(4000)
        # NÃO desiste no SSO: espera o A3 ser concluído na janela (o certificado é
        # apresentado pelo usuário; o script só observa o form aparecer).
        avisou = False
        campo = None
        for _ in range(300):                     # até ~5 min
            # durante o SSO a página navega várias vezes; qualquer consulta ao DOM
            # no meio disso estoura "Execution context was destroyed". Ignorar e
            # tentar de novo é o comportamento correto — não é erro, é redirect.
            try:
                campo = pg.query_selector(SEL_CNPJ)
                if campo:
                    break
                url = pg.url.lower()
            except Exception:
                url = ""
            if not avisou and any(k in url for k in ("sso", "login", "auth")):
                print("    >>> faça o LOGIN A3 do TRF5 nesta janela do Chrome "
                      "(aguardando o formulário de consulta)...")
                avisou = True
            try:
                pg.wait_for_timeout(1000)
            except Exception:
                time.sleep(1)
        if not campo:
            return "campo de CNPJ não encontrado (login não concluído?)", []
        campo.click()
        campo.fill(re.sub(r"\D", "", cnpj))
        pg.keyboard.press("Tab")
        pg.wait_for_timeout(800)
        btn = (pg.query_selector("input[id$=':searchButton']")
               or pg.query_selector("input[value='Pesquisar'], button:has-text('Pesquisar')"))
        if not btn:
            return "botão Pesquisar não encontrado", []
        btn.click()
        # a consulta federal leva 20-30s; espera o contador estabilizar
        n, estavel = None, 0
        for _ in range(90):
            pg.wait_for_timeout(1000)
            atual = _contador(pg)
            if atual is not None and atual == n:
                estavel += 1
                if estavel >= 3:
                    break
            else:
                n, estavel = atual, 0
        txt = pg.evaluate("() => (document.body ? document.body.innerText : '')") or ""
        procs = sorted(set(RE_PROC.findall(txt)))
        return (f"contador={n}"), procs
    finally:
        try: pg.close()
        except Exception: pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cnpj", required=True)
    ap.add_argument("--port", type=int, default=9223)
    a = ap.parse_args()
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{a.port}")
        ctx = browser.contexts[0]
        achados = {}
        for rot, cam in TELAS.items():
            status, procs = sondar(ctx, cam, a.cnpj)
            achados[rot] = set(procs)
            print(f"\n{rot}: {status} | {len(procs)} processo(s)")
            for x in procs:
                print("   ", x)
        a_, b_ = (achados.get("ConsultaProcesso        ", set()),
                  achados.get("ConsultaProcessoTerceiros", set()))
        so_terceiros = b_ - a_
        print("\n" + "=" * 70)
        if so_terceiros:
            print(f"VEREDITO: a consulta de TERCEIROS achou {len(so_terceiros)} processo(s) "
                  "que a consulta normal NÃO mostra — o 2.x tem a mesma limitação do 1.x "
                  "e as varreduras federais estão INCOMPLETAS:")
            for x in sorted(so_terceiros):
                print("   +", x)
        elif a_ or b_:
            print("VEREDITO: as duas telas devolveram o MESMO conjunto — no 2.x federal a "
                  "consulta normal já mostra processos de terceiros; nada a corrigir.")
        else:
            print("VEREDITO: nenhuma das telas devolveu processo (login? CNPJ sem caso?).")
        # NÃO fecha o browser: modo CDP usa o Chrome real do usuário.


if __name__ == "__main__":
    main()
