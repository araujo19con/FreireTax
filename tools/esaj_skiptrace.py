# -*- coding: utf-8 -*-
"""
esaj_skiptrace.py — tentativa de enriquecer CONTATO dos sócios de SP via e-SAJ (TJSP).

⛔ VEREDITO (testado 15/06 via CDP+A3): e-SAJ NÃO é viável p/ skip-trace.
A busca por nome FUNCIONA e os sócios SP TÊM processos no e-SAJ (ex: AGNES=5,
ALBERTO=2), MAS a página do processo (show.do) mostra só os NOMES das partes —
SEM CPF/endereço. A qualificação está nos AUTOS ("Visualizar autos" / pasta
digital), que o e-SAJ só libera a quem é "advogado(a) NESSE processo" (habilitado)
ou tem a "senha do processo" (dada às partes). Não sendo parte, o CPF é inacessível.
Isso difere do PJe (RN) e do eproc, onde qualquer advogado logado lê a petição.
Logo SP não tem caminho judicial: eproc-SP ~0 cobertura + e-SAJ autos bloqueados.
Script mantido como referência (a busca/listagem funcionam; o que falta é o acesso
aos autos, que é uma barreira de habilitação, não técnica).

----
enriquece CONTATO dos sócios de SP a partir do e-SAJ (TJSP),
reusando a SESSÃO LOGADA (A3) via CDP no Chrome real.

POR QUÊ: TJSP usa e-SAJ (legado, a maior parte dos processos) + eproc (novo, pouco
ainda). Os sócios de SP filtrados quase não aparecem no eproc (ver eproc_skiptrace)
— estão no e-SAJ. Sistema DIFERENTE: consulta cpopg (1º grau), DOM próprio.

REUSO: parse_qualificacao/cpf_confere/parece_pj/avaliar_socio do pje_rn_skiptrace
(parser agnóstico de sistema). Login via CDP (e-SAJ tem login Keycloak/cert que o
Chromium do Playwright não apresenta — mesmo motivo do eproc).

⚠️ INCERTEZA (validar com --inspect): o e-SAJ restringe acesso aos AUTOS mais que
PJe/eproc. A consulta por nome (cpopg) retorna a LISTA de processos + partes, mas o
CPF/endereço estão na PETIÇÃO, cujo acesso pode exigir habilitação no processo.
`--inspect` faz 1 busca de teste, abre 1 processo e RELATA o que é acessível (texto
da petição com CPF, ou só metadados). Se não der pra ler a petição, e-SAJ não serve
p/ skip-trace (e SP fica sem essa fonte).

FLUXO: cpopg/open.do -> cbPesquisa='NMPARTE' (habilita #campo_NMPARTE) -> preenche
-> #botaoConsultarProcessos -> lista (links show.do) -> abre processo -> extrai.

USO (e-SAJ exige login PRÓPRIO, separado do eproc):
  tools/chrome-cdp.ps1   (navegue p/ https://esaj.tjsp.jus.br/cpopg/open.do e logue A3)
  python tools/esaj_skiptrace.py --inspect --cdp        # valida acesso aos autos
  python tools/esaj_skiptrace.py --limit 150 --cdp      # grava
  python tools/esaj_skiptrace.py --reparse esaj_sp_dump.jsonl   # offline
"""
import os, sys, re, csv, json, time, argparse, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

from tools.pje_rn_skiptrace import (  # noqa: E402
    sb, parse_qualificacao, cpf_confere, parece_pj, RE_CPF, avaliar_socio,
)

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

UF = "SP"
TJ_NOME = "TJSP"
MARKER = "e-SAJ/TJSP"
BASE = "https://esaj.tjsp.jus.br/cpopg/open.do"
SEARCH = "https://esaj.tjsp.jus.br/cpopg/search.do"
LEDGER = ROOT / "esaj_sp_ledger.jsonl"
DUMP = ROOT / "esaj_sp_dump.jsonl"

# Seletores e-SAJ cpopg (extraídos do HTML real 15/06)
SEL_CB = "#cbPesquisa, select[name='cbPesquisa']"
CB_NOME = "NMPARTE"
SEL_NOME = "#campo_NMPARTE, input[name='dadosConsulta.valorConsulta']"
SEL_CONSULTAR = "#botaoConsultarProcessos, input[value='Consultar']"
# marcadores de login (específicos — não casar dentro de palavra; ver bug 'sso' do eproc)
_LOGIN_MARK = ("sso.", "/login", "login.", "openid-connect", "keycloak",
               "saml", "realms/", "idp_hint", "certificad")


# ---------------------------------------------------------------------------
def ledger_nomes():
    s = set()
    if LEDGER.exists():
        for line in open(LEDGER, encoding="utf-8"):
            line = line.strip()
            if line:
                try:
                    s.add((json.loads(line).get("nome") or "").upper())
                except Exception:
                    pass
    return s


def ledger_add(nome, mask, result, flags=""):
    with open(LEDGER, "a", encoding="utf-8") as f:
        f.write(json.dumps({"nome": nome, "mask": mask, "result": result,
                            "flags": flags}, ensure_ascii=False) + "\n")


def carregar_socios(limit):
    q = ("empresa_contatos?select=id,empresa_id,nome,cpf_mascarado,telefone,email,"
         "observacoes,empresas!inner(uf)&papel=eq.socio&cpf_mascarado=not.is.null"
         f"&cpf_mascarado=like.*%2A*&empresas.uf=eq.{UF}&order=nome.asc")
    done = ledger_nomes()
    vistos, alvos, offset, page = set(), [], 0, 1000
    while len(alvos) < limit:
        rows = sb(q + f"&limit={page}&offset={offset}") or []
        if not rows:
            break
        offset += page
        for r in rows:
            nome = (r.get("nome") or "").strip()
            if not nome:
                continue
            up = nome.upper()
            if up in vistos or up in done:
                continue
            if MARKER in (r.get("observacoes") or ""):
                continue
            if parece_pj(nome):
                continue
            vistos.add(up)
            alvos.append(r)
            if len(alvos) >= limit:
                break
    return alvos


# ---------------------------------------------------------------------------
# Browser via CDP (Chrome real logado no e-SAJ)
# ---------------------------------------------------------------------------
def _ctx_cdp(p, port):
    browser = p.chromium.connect_over_cdp(f"http://localhost:{port}")
    if not browser.contexts:
        raise RuntimeError("CDP sem contexto. Abra uma aba no Chrome.")
    return browser, browser.contexts[0]


def _logado_esaj(pg):
    """e-SAJ: a consulta cpopg/open.do é acessível mesmo sem login (busca pública);
    o login só importa p/ abrir documentos. Então 'pronto' = estar no cpopg."""
    u = (pg.url or "").lower()
    if "esaj.tjsp.jus.br" not in u or any(m in u for m in _LOGIN_MARK):
        return False
    return "cpopg" in u


def _ir_para_consulta(page):
    if "cpopg/open.do" in (page.url or "") or page.query_selector(SEL_CB):
        return bool(page.query_selector(SEL_CB))
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1200)
    return bool(page.query_selector(SEL_CB))


def _aguardar(ctx):
    """Acha/abre a aba do e-SAJ cpopg (até ~40 min, navega 1x se preciso)."""
    navegou = False
    for _ in range(1200):
        for pg in list(ctx.pages):
            try:
                if _logado_esaj(pg) or pg.query_selector(SEL_CB):
                    return pg
            except Exception:
                pass
        if not navegou:
            tem = any("esaj.tjsp" in (pg.url or "").lower() for pg in ctx.pages)
            if not tem:
                try:
                    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
                    pg.goto(BASE, wait_until="domcontentloaded", timeout=30000)
                    navegou = True
                except Exception:
                    pass
        time.sleep(2)
    return None


def pesquisar(page, nome):
    """Busca por nome no e-SAJ cpopg. Retorna [{proc, idx, texto, link}]."""
    if not _ir_para_consulta(page):
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1000)
    # 1) tipo de pesquisa = Nome da parte (habilita o campo)
    try:
        page.select_option(SEL_CB, CB_NOME)
        page.wait_for_timeout(600)
    except Exception:
        pass
    # 2) preenche nome (força habilitar se vier disabled)
    try:
        page.fill(SEL_NOME, nome, timeout=8000)
    except Exception:
        page.eval_on_selector(SEL_NOME, """(el, v) => {
          el.disabled=false; el.value=v;
          el.dispatchEvent(new Event('input', {bubbles:true}));
        }""", nome)
    # 3) consultar
    try:
        page.click(SEL_CONSULTAR, timeout=8000)
    except Exception:
        page.eval_on_selector(SEL_CONSULTAR, "el => el.click()")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(2500)
    # 4) parseia a lista de resultados: links show.do + nº CNJ
    return page.evaluate(r"""() => {
      const out = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="show.do"]').forEach(a => {
        const txt = (a.innerText||'').trim();
        const m = txt.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
        if (m && !seen.has(m[0])) {
          seen.add(m[0]);
          out.push({ proc: m[0], link: a.getAttribute('href'), texto: txt.slice(0,80) });
        }
      });
      return out;
    }""")


def abrir_e_extrair(page, proc, link):
    """Abre o processo (show.do) e extrai o texto. Tenta a petição/documentos."""
    # urljoin resolve corretamente links relativos ('show.do?...'), absolutos
    # ('/cpopg/show.do?...') e completos, usando a URL atual (search.do) como base.
    url = urllib.parse.urljoin(page.url, link)
    page.goto(url, wait_until="domcontentloaded", timeout=40000)
    page.wait_for_timeout(2000)
    # texto da página do processo (partes/movimentações) — já pode ter qualificação
    txt = page.evaluate("() => document.body ? document.body.innerText : ''")
    # tenta abrir 1 documento/petição vinculado, se houver link acessível
    try:
        doc = page.query_selector("a[href*='abrirDocumento'], a[href*='getPDF'], a[href*='Documento']")
        if doc:
            with page.context.expect_page(timeout=6000) as pinfo:
                doc.click()
            dp = pinfo.value
            dp.wait_for_load_state("domcontentloaded")
            dp.wait_for_timeout(2000)
            dtxt = dp.evaluate(r"""() => {
              const ifr=[...document.querySelectorAll('iframe')].find(f=>/pdf|viewer|documento/.test(f.src||''));
              if(ifr){try{const d=ifr.contentDocument; if(d){let t='';d.querySelectorAll('.textLayer').forEach(l=>t+=l.innerText+'\n');if(t)return t;return d.body?d.body.innerText:'';}}catch(e){}}
              return document.body?document.body.innerText:'';
            }""")
            if dtxt and len(dtxt) > len(txt):
                txt = dtxt
            try:
                dp.close()
            except Exception:
                pass
    except Exception:
        pass
    return txt


def gravar(socio, q):
    nome = socio["nome"]
    obs = (f"{MARKER} (proc {q.get('proc','')}): "
           + (f"{q['endereco']}. " if q.get("endereco") else "")
           + (f"Adv: {q['advogado']}. " if q.get("advogado") else "")
           + ("CPF conferido pela mascara." if q.get("cpf") and not q.get("fraco")
              else "identidade provavel (parte)."))
    patch = {"observacoes": obs}
    if q.get("telefone"):
        patch["telefone"] = q["telefone"]
    if q.get("email"):
        patch["email"] = q["email"]
    flt = f"empresa_contatos?nome=eq.{urllib.parse.quote(nome)}"
    mask = socio.get("cpf_mascarado")
    if mask:
        flt += f"&cpf_mascarado=eq.{urllib.parse.quote(mask)}"
    sb(flt, method="PATCH", body=patch, prefer="return=minimal")


# ---------------------------------------------------------------------------
def inspect(sample=None, port=9222):
    """Valida o e-SAJ: 1 busca de teste, abre 1 processo, relata o que é acessível
    (texto com CPF = viável; só metadados = inviável p/ skip-trace)."""
    from playwright.sync_api import sync_playwright
    if not sample:
        alvos = carregar_socios(1)
        sample = alvos[0]["nome"] if alvos else "SILVA"
    with sync_playwright() as p:
        _, ctx = _ctx_cdp(p, port)
        print(">>> CDP. Aguardando aba e-SAJ cpopg (logue A3 em esaj.tjsp.jus.br/cpopg/open.do)...", flush=True)
        page = _aguardar(ctx)
        if not page:
            print("Timeout. Saindo."); return
        print(f">>> Pronto. URL: {page.url}", flush=True)
        print(f"\n>>> Busca de teste: '{sample}'", flush=True)
        rows = pesquisar(page, sample)
        print(f"    {len(rows)} processos encontrados.", flush=True)
        for r in rows[:5]:
            print(f"     - {r['proc']}", flush=True)
        (ROOT / "esaj_resultados.html").write_text(page.content(), encoding="utf-8")
        if rows:
            print(f"\n>>> Abrindo {rows[0]['proc']} e checando acesso à qualificação...", flush=True)
            txt = abrir_e_extrair(page, rows[0]["proc"], rows[0]["link"])
            (ROOT / "esaj_processo.html").write_text(page.content(), encoding="utf-8")
            tem_cpf = "SIM" if RE_CPF.search(txt or "") else "NAO"
            print(f"    texto: {len(txt or '')} chars | tem CPF: {tem_cpf}", flush=True)
            if txt:
                amostra = re.sub(r'\s+', ' ', txt[:400]).strip()
                print(f"    amostra: {amostra}", flush=True)
            print("\n    VEREDITO: " + ("e-SAJ EXPÕE qualificação -> skip-trace VIÁVEL"
                  if tem_cpf == "SIM" else
                  "só metadados (sem CPF) -> conferir esaj_processo.html; pode precisar abrir a petição"), flush=True)
        print("\n>>> Snapshots: esaj_resultados.html / esaj_processo.html", flush=True)


def run(limit, dry, dump, port=9222):
    from playwright.sync_api import sync_playwright
    alvos = carregar_socios(limit)
    print(f"> {len(alvos)} sócios {UF} a processar (PF, sem enriquecimento {MARKER}).")
    if not alvos:
        return
    out_csv = ROOT / "esaj_sp_skiptrace.csv"
    resultados = []
    with sync_playwright() as p:
        _, ctx = _ctx_cdp(p, port)
        print(">>> CDP. Aguardando aba e-SAJ cpopg logada...", flush=True)
        page = _aguardar(ctx)
        if not page:
            print("Timeout aguardando e-SAJ. Saindo."); return
        print(">>> Pronto. Iniciando varredura.", flush=True)
        if dump and DUMP.exists():
            DUMP.unlink()
        erros = 0
        for i, s in enumerate(alvos, 1):
            nome, mask = s["nome"], s["cpf_mascarado"]
            try:
                rows = pesquisar(page, nome)
                erros = 0
            except Exception as e:
                erros += 1
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} ERRO: {str(e)[:50]}")
                if erros >= 4:
                    print(">>> 4 erros seguidos — abortando (resumível)."); break
                continue
            if not rows:
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} sem processo")
                if not dry:
                    ledger_add(nome, mask, "sem_processo")
                continue
            got = None
            for r in rows[:4]:
                try:
                    txt = abrir_e_extrair(page, r["proc"], r["link"])
                except Exception as e:
                    print(f"     (falha abrir {r['proc'][:25]}: {str(e)[:35]})")
                    continue
                if not txt:
                    continue
                if dump:
                    with open(DUMP, "a", encoding="utf-8") as df:
                        df.write(json.dumps({"nome": nome, "mask": mask, "proc": r["proc"],
                                             "ativo": True, "texto": txt}, ensure_ascii=False) + "\n")
                q = parse_qualificacao(txt, nome, mask)
                if q["cpf"] and cpf_confere(q["cpf"], mask):
                    q["proc"] = r["proc"]; got = q; break
                if not got and (q["endereco"] or q["telefone"]):
                    q["proc"] = r["proc"]; q["fraco"] = True; got = q
            flags = ""
            if got:
                flags = "".join(ch for ch, k in [("#", "cpf"), ("E", "endereco"),
                                                 ("T", "telefone"), ("@", "email")] if got.get(k))
                resultados.append({"nome": nome, "mask": mask, **got})
                if not dry:
                    try:
                        gravar(s, got)
                    except Exception as e:
                        print(f"     (falha gravar: {str(e)[:35]})"); time.sleep(1); continue
            if not dry:
                ledger_add(nome, mask, "hit" if got else "sem_match", flags)
            print(f"[{i}/{len(alvos)}] {nome[:30]:30} {len(rows)} proc -> {flags or 'sem match'}")
            time.sleep(0.5)
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        if resultados:
            w = csv.DictWriter(f, fieldnames=list(resultados[0].keys()))
            w.writeheader(); w.writerows(resultados)
    com_tel = sum(1 for r in resultados if r.get("telefone"))
    print(f"\n> {len(resultados)} sócios enriquecidos (telefone:{com_tel}). CSV: {out_csv.name}")


def reparse_main(path):
    import collections
    cands = collections.OrderedDict()
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                d = json.loads(line)
                cands.setdefault((d["nome"], d["mask"]), []).append(d)
    n = dict(match=0, cpf=0, end=0, tel=0, mail=0)
    for (nome, mask), cs in cands.items():
        got = avaliar_socio(cs, nome, mask)
        if not got:
            print(f"  {nome[:32]:32} sem match"); continue
        flags = "".join(ch for ch, k in [("#", "cpf"), ("E", "endereco"),
                                          ("T", "telefone"), ("@", "email")] if got.get(k))
        n["match"] += 1
        n["cpf"] += bool(got.get("cpf")); n["end"] += bool(got.get("endereco"))
        n["tel"] += bool(got.get("telefone")); n["mail"] += bool(got.get("email"))
        print(f"  {nome[:32]:32} -> {flags:4} {got.get('telefone','') or '':16} {(got.get('endereco','') or '')[:46]}")
    print(f"\n> REPARSE {len(cands)} | match {n['match']} | CPF {n['cpf']} | end {n['end']} | TEL {n['tel']} | @ {n['mail']}")


def main():
    ap = argparse.ArgumentParser(description="e-SAJ skip-trace (SP)")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dump", action="store_true")
    ap.add_argument("--inspect", action="store_true")
    ap.add_argument("--cdp", action="store_true", help="conecta no Chrome real (--remote-debugging-port)")
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--sample", metavar="NOME")
    ap.add_argument("--reparse", metavar="JSONL")
    args = ap.parse_args()

    if args.reparse:
        return reparse_main(args.reparse)
    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.")
    if not args.cdp:
        sys.exit("ERRO: e-SAJ exige --cdp (login A3 no Chrome real; ver tools/chrome-cdp.ps1).")
    if args.inspect:
        return inspect(args.sample, args.port)
    run(args.limit, args.dry_run, args.dump, args.port)


if __name__ == "__main__":
    main()
