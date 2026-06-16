# -*- coding: utf-8 -*-
"""
projudi_skiptrace.py — enriquece CONTATO dos sócios do PR a partir do Projudi
(TJPR), reusando a SESSÃO LOGADA (certificado A3) no próprio browser.

POR QUÊ UM SCRIPT À PARTE: o PR DESATIVOU o PJe e migrou os processos pro Projudi
(`projudi.tjpr.jus.br`; o `pje.tjpr.jus.br` é legado morto). O Projudi é um sistema
PRÓPRIO (framesets, navegação por menu) — DOM/fluxo diferentes do PJe e do eproc.
MAS o miolo — extrair CPF/endereço/telefone da petição e CONFERIR pela máscara do
QSA — é AGNÓSTICO de sistema: reusamos `parse_qualificacao`/`cpf_confere`/`parece_pj`
do pje_rn_skiptrace (mesmo padrão do eproc_skiptrace).

⚠️ SCAFFOLD: diferente do eproc (onde extraí os seletores reais do HTML do TRF4),
o Projudi usa framesets e a busca por nome exige login — não dá p/ pegar os
seletores estáticos sem A3. Os SEL_* abaixo são o ponto de partida; rode
`--inspect` UMA vez (loga, salva HTML/screenshot de cada frame + lista os campos)
pra fechar SEL_NOME/SEL_PESQUISAR/SEL_DOC. Depois roda igual ao RN/eproc.

FLUXO (por sócio), mesmo espírito do RN/eproc:
  1. Consulta processual por "Nome da parte" no Projudi.
  2. Abre os autos → 1º documento (petição) → lê o texto.
  3. parse_qualificacao + confere CPF pela máscara → grava só no match.
  4. Marca observacoes 'Projudi/TJPR' (resumível).

USO:
  python tools/projudi_skiptrace.py --inspect            # calibra seletores
  python tools/projudi_skiptrace.py --limit 30 --dry-run
  python tools/projudi_skiptrace.py --limit 150          # grava
  python tools/projudi_skiptrace.py --reparse projudi_pr_dump.jsonl   # offline
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

UF = "PR"
TJ_NOME = "TJPR"
MARKER = "Projudi/TJPR"
BASE = "https://projudi.tjpr.jus.br/projudi/"
PROFILE = str(ROOT / ".projudi-chrome-profile")
LEDGER = ROOT / "projudi_pr_ledger.jsonl"
DUMP = ROOT / "projudi_pr_dump.jsonl"

# --- SELETORES A CALIBRAR via --inspect (Projudi usa framesets + busca logada) --
# Ponto de partida; confirme com --inspect (ele lista os ids reais de cada frame).
SEL_NOME = ("input[name='nomeParte'], input[name='nomePessoa'], "
            "input[id*='nomeParte'], input[name*='nome']")
SEL_PESQUISAR = ("input[value*='Pesquisar'], input[value*='Consultar'], "
                 "button:has-text('Pesquisar'), input[type='submit']")
SEL_DOC = "a[href*='documento'], a[onclick*='documento'], a[href*='arquivo'], table a"


# ---------------------------------------------------------------------------
# Alvos: sócios PF do PR sem enriquecimento Projudi (resume pelo marcador)
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
# Browser — reusa a sessão logada A3
# ---------------------------------------------------------------------------
def _frame_com_campo(page):
    """Procura o frame (Projudi usa framesets) que tem o campo de nome."""
    for fr in page.frames:
        try:
            if fr.query_selector(SEL_NOME):
                return fr
        except Exception:
            pass
    return page.main_frame if page.query_selector(SEL_NOME) else None


# marcadores de login específicos (não casar dentro de palavra — ver bug 'sso'
# em 'processo' no eproc). Projudi usa login próprio.
_LOGIN_MARK = ("sso.", "/login", "login.", "openid-connect", "keycloak",
               "saml", "realms/", "idp_hint", "certificad", "usuario/login")


def _ctx_cdp(p, port):
    """Conecta no Chrome REAL do usuário (--remote-debugging-port). Resolve login
    A3/Keycloak que o Chromium do Playwright não apresenta."""
    browser = p.chromium.connect_over_cdp(f"http://localhost:{port}")
    if not browser.contexts:
        raise RuntimeError("CDP sem contexto. Abra uma aba no Chrome.")
    return browser, browser.contexts[0]


def _logado_projudi(pg):
    """Sessão Projudi logada = URL do projudi fora da tela de login + campo de
    consulta presente em algum frame."""
    u = (pg.url or "").lower()
    if "projudi" not in u or any(m in u for m in _LOGIN_MARK):
        return False
    if _frame_com_campo(pg):
        return True
    # autenticado mas talvez não na tela de consulta: aceita se tiver menu/sair
    try:
        for f in pg.frames:
            t = f.inner_text("body") or ""
            if "Sair" in t and ("Consulta" in t or "Processo" in t):
                return True
    except Exception:
        pass
    return False


def aguardar_login(ctx):
    LOGIN = _LOGIN_MARK
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    except Exception:
        pass
    print(">>> Faça LOGIN no Projudi-TJPR com o A3 na janela do Chrome.", flush=True)
    print(">>> Aguardando autenticação (campo de consulta por nome aparecer)...", flush=True)
    for it in range(300):  # ~10 min
        for pg in list(ctx.pages):
            try:
                if _frame_com_campo(pg):
                    return pg
            except Exception:
                pass
        for pg in list(ctx.pages):
            u = (pg.url or "").lower()
            if "projudi" in u and not any(m in u for m in LOGIN):
                try:
                    pg.goto(BASE, wait_until="domcontentloaded", timeout=30000)
                    pg.wait_for_timeout(1200)
                    if _frame_com_campo(pg):
                        return pg
                except Exception:
                    pass
        time.sleep(2)
    return None


def pesquisar(page, nome):
    """Busca por nome no Projudi. Retorna [{proc, idx, texto}]. SELETORES a calibrar."""
    fr = _frame_com_campo(page)
    if not fr:
        raise RuntimeError("sessao expirada (campo de consulta ausente)")
    fr.fill(SEL_NOME, nome)
    fr.click(SEL_PESQUISAR)
    page.wait_for_timeout(2500)
    # varre TODOS os frames por linhas com nº CNJ
    out = []
    for f in page.frames:
        try:
            rows = f.evaluate(r"""() => {
              return [...document.querySelectorAll('table tr')].map((tr, idx) => {
                const m = tr.innerText.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
                if (!m) return null;
                return { proc: m[0], idx, texto: tr.innerText.replace(/\s+/g,' ').trim() };
              }).filter(Boolean);
            }""")
            out.extend(rows or [])
        except Exception:
            pass
    # dedup por proc
    seen, uniq = set(), []
    for r in out:
        if r["proc"] not in seen:
            seen.add(r["proc"]); uniq.append(r)
    return uniq


def abrir_e_extrair(page, proc):
    """Abre os autos e extrai o texto do 1º documento. SELETORES a calibrar."""
    ctx = page.context
    novo = None
    try:
        with ctx.expect_page(timeout=8000) as pinfo:
            for f in page.frames:
                try:
                    f.evaluate("""(proc) => {
                      const tr=[...document.querySelectorAll('table tr')].find(t=>t.innerText.includes(proc));
                      const a=tr && tr.querySelector('a'); if(a) a.click();
                    }""", proc)
                except Exception:
                    pass
        novo = pinfo.value
    except Exception:
        novo = page
    autos = novo
    autos.wait_for_load_state("domcontentloaded")
    autos.wait_for_timeout(2000)
    try:
        autos.click(SEL_DOC, timeout=6000)
        autos.wait_for_timeout(2000)
    except Exception:
        pass
    txt = ""
    for k in range(14):
        # tenta extrair de todos os frames + iframes PDF
        for f in autos.frames:
            try:
                t = f.evaluate(r"""() => {
                  const ifr=[...document.querySelectorAll('iframe')].find(f=>/pdf|viewer|documento|arquivo/.test(f.src||''));
                  if(ifr){ try{ const d=ifr.contentDocument; if(d){
                    let t=''; d.querySelectorAll('.textLayer').forEach(l=>t+=l.innerText+'\n');
                    if(t) return t; return d.body?d.body.innerText:''; } }catch(e){} }
                  return document.body ? document.body.innerText : '';
                }""")
                if t and len(t) > len(txt):
                    txt = t
            except Exception:
                pass
        if txt and (len(txt) > 600 or RE_CPF.search(txt)):
            break
        if k >= 7 and len(txt or "") < 300:
            break
        autos.wait_for_timeout(900)
    if novo is not page:
        try:
            autos.close()
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
# --inspect: calibração (loga, dumpa cada frame + lista campos)
# ---------------------------------------------------------------------------
def _aguardar_cdp(ctx):
    """Acha a aba do Projudi logada (CDP). Navega 1 aba p/ a base se preciso."""
    navegou = False
    for _ in range(1200):  # ~40 min
        for pg in list(ctx.pages):
            try:
                if _logado_projudi(pg):
                    return pg
            except Exception:
                pass
        if not navegou:
            if not any("projudi" in (pg.url or "").lower() for pg in ctx.pages):
                try:
                    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
                    pg.goto(BASE, wait_until="domcontentloaded", timeout=30000)
                    navegou = True
                except Exception:
                    pass
        time.sleep(2)
    return None


def inspect(sample=None, cdp=False, port=9222):
    from playwright.sync_api import sync_playwright
    if not sample:
        alvos = carregar_socios(1)
        sample = alvos[0]["nome"] if alvos else "SILVA"
    with sync_playwright() as p:
        if cdp:
            _, ctx = _ctx_cdp(p, port)
            print(f">>> CDP (porta {port}). Abra {BASE} e LOGUE com A3...", flush=True)
            page = _aguardar_cdp(ctx)
        else:
            ctx = p.chromium.launch_persistent_context(
                PROFILE, headless=False, viewport={"width": 1280, "height": 900})
            ctx.on("page", lambda pg: pg.on("dialog", lambda d: d.accept()))
            page = aguardar_login(ctx)
        if not page:
            print("Timeout no login.")
            if not cdp:
                ctx.close()
            return
        print(f">>> Pronto. URL: {page.url}", flush=True)
        print(">>> [1/2] Frames + campos da tela de consulta:", flush=True)
        for i, fr in enumerate(page.frames):
            try:
                campos = fr.evaluate(r"""() => {
                  const inp=[...document.querySelectorAll('input,select')].map(e=>({
                    tag:e.tagName, id:e.id, name:e.name, type:e.type, val:(e.value||'').slice(0,20)}));
                  const btn=[...document.querySelectorAll('button,input[type=submit],input[type=button]')]
                    .map(e=>({id:e.id, name:e.name, val:e.value, txt:(e.innerText||'').slice(0,25)}));
                  return {inputs: inp.slice(0,25), buttons: btn.slice(0,15)};
                }""")
                if campos["inputs"] or campos["buttons"]:
                    print(f"  frame[{i}] {fr.url[:70]}", flush=True)
                    print("   " + json.dumps(campos, ensure_ascii=False)[:700], flush=True)
                    (ROOT / f"projudi_frame{i}.html").write_text(fr.content(), encoding="utf-8")
            except Exception:
                pass
        page.screenshot(path=str(ROOT / "projudi_consulta.png"), full_page=True)
        print(f"\n>>> [2/2] Busca de teste: '{sample}'", flush=True)
        try:
            rows = pesquisar(page, sample)
            print(f"    {len(rows)} processos.", flush=True)
            page.screenshot(path=str(ROOT / "projudi_resultados.png"), full_page=True)
            if rows:
                txt = abrir_e_extrair(page, rows[0]["proc"])
                print(f"    1º proc: {len(txt or '')} chars | CPF: {'SIM' if RE_CPF.search(txt or '') else 'nao'}", flush=True)
        except Exception as e:
            print(f"    ERRO: {e}", flush=True)
        print(">>> Snapshots: projudi_frame*.html / projudi_*.png", flush=True)
        if sys.stdin.isatty():
            input(">>> ENTER pra fechar.")
        else:
            page.wait_for_timeout(3000)
        if not cdp:
            ctx.close()  # CDP: não fechar o Chrome do usuário


# ---------------------------------------------------------------------------
# Lote
# ---------------------------------------------------------------------------
def run(limit, dry, dump, cdp=False, port=9222):
    from playwright.sync_api import sync_playwright
    alvos = carregar_socios(limit)
    print(f"> {len(alvos)} sócios {UF} a processar (PF, sem enriquecimento {MARKER}).")
    if not alvos:
        return
    out_csv = ROOT / "projudi_pr_skiptrace.csv"
    resultados = []
    with sync_playwright() as p:
        if cdp:
            _, ctx = _ctx_cdp(p, port)
            print(f">>> CDP (porta {port}). Aguardando sessão Projudi logada...", flush=True)
            page = _aguardar_cdp(ctx)
        else:
            ctx = p.chromium.launch_persistent_context(
                PROFILE, headless=False, viewport={"width": 1280, "height": 900})
            ctx.on("page", lambda pg: pg.on("dialog", lambda d: d.accept()))
            page = aguardar_login(ctx)
        if not page:
            print("Timeout aguardando login. Saindo.")
            if not cdp:
                ctx.close()
            return
        print(">>> Autenticado. Iniciando varredura.", flush=True)
        if dump and DUMP.exists():
            DUMP.unlink()
        erros = 0              # falhas seguidas na BUSCA (form ausente = sessão caiu)
        aberturas_falhas = 0   # sócios seguidos com processos mas NENHUM autos abriu
        enriquecidos = 0       # hits efetivamente gravados neste lote
        LIMITE_ABERTURA = 5    # autos não abrem N× seguidas = limite diário do tribunal
        for i, s in enumerate(alvos, 1):
            nome, mask = s["nome"], s["cpf_mascarado"]
            try:
                rows = pesquisar(page, nome)
                erros = 0
            except Exception as e:
                erros += 1
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} ERRO busca: {str(e)[:50]}")
                if erros >= 4:
                    print(">>> 4 erros seguidos na BUSCA — sessão A3 caiu. Relogue e rode de novo (resumível).")
                    break
                continue
            if not rows:
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} sem processo")
                if not dry:
                    ledger_add(nome, mask, "sem_processo")
                continue
            got = None
            abriu_algum = False      # algum processo realmente abriu e rendeu texto?
            falha_abertura = False   # algum open lançou exceção (popup/aba não veio)
            for r in rows[:4]:
                try:
                    txt = abrir_e_extrair(page, r["proc"])
                except Exception as e:
                    print(f"     (falha ao abrir {r['proc'][:25]}: {str(e)[:40]})")
                    falha_abertura = True
                    continue
                if not txt:
                    continue
                abriu_algum = True
                if dump:
                    with open(DUMP, "a", encoding="utf-8") as df:
                        df.write(json.dumps({"nome": nome, "mask": mask, "proc": r["proc"],
                                             "ativo": True, "texto": txt}, ensure_ascii=False) + "\n")
                q = parse_qualificacao(txt, nome, mask)
                if q["cpf"] and cpf_confere(q["cpf"], mask):
                    q["proc"] = r["proc"]; got = q; break
                if not got and (q["endereco"] or q["telefone"]):
                    q["proc"] = r["proc"]; q["fraco"] = True; got = q

            # LIMITE DIÁRIO vs QUEDA DE SESSÃO: TINHA processos na busca mas NENHUM
            # autos abriu (todos deram erro) — não é "sem match", os autos foram
            # bloqueados. Como a busca segue OK (sessão viva), é o limite diário do
            # tribunal. Não ledgeriza (re-tenta noutro dia) e conta como falha seguida.
            if not got and not abriu_algum and falha_abertura:
                aberturas_falhas += 1
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} {len(rows)} proc -> AUTOS NÃO ABRIRAM (não gravado)")
                if aberturas_falhas >= LIMITE_ABERTURA:
                    print(f">>> {aberturas_falhas} sócios seguidos: processos existem mas NENHUM autos abriu.")
                    print(">>> A BUSCA ainda funciona (sessão A3 viva) => é o LIMITE DIÁRIO do tribunal, não a sessão.")
                    print(">>> Relogar NÃO resolve. Pare hoje e retome amanhã (resumível; nada gravado errado).")
                    break
                continue
            aberturas_falhas = 0  # abriu algo (ou foi teto real de extração) -> zera

            flags = ""
            if got:
                flags = "".join(ch for ch, k in [("#", "cpf"), ("E", "endereco"),
                                                 ("T", "telefone"), ("@", "email")] if got.get(k))
                resultados.append({"nome": nome, "mask": mask, **got})
                if not dry:
                    try:
                        gravar(s, got)
                    except Exception as e:
                        print(f"     (falha ao gravar {nome[:20]}: {str(e)[:40]})")
                        time.sleep(1); continue
                enriquecidos += 1
            if not dry:
                ledger_add(nome, mask, "hit" if got else "sem_match", flags)
            print(f"[{i}/{len(alvos)}] {nome[:30]:30} {len(rows)} proc -> {flags or 'sem match'}")
            time.sleep(0.5)
        if not cdp:
            ctx.close()  # CDP: não fechar o Chrome do usuário
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        if resultados:
            w = csv.DictWriter(f, fieldnames=list(resultados[0].keys()))
            w.writeheader(); w.writerows(resultados)
    com_tel = sum(1 for r in resultados if r.get("telefone"))
    grav = enriquecidos if not dry else 0
    print(f"\n> {len(resultados)} sócios com match (telefone:{com_tel}) | {grav} gravados no CRM. CSV: {out_csv.name}")


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
            print(f"  {nome[:32]:32} {len(cs):2}d -> sem match"); continue
        flags = "".join(ch for ch, k in [("#", "cpf"), ("E", "endereco"),
                                          ("T", "telefone"), ("@", "email")] if got.get(k))
        n["match"] += 1
        n["cpf"] += bool(got.get("cpf")); n["end"] += bool(got.get("endereco"))
        n["tel"] += bool(got.get("telefone")); n["mail"] += bool(got.get("email"))
        print(f"  {nome[:32]:32} {len(cs):2}d -> {flags:4} {got.get('telefone','') or '':16} {(got.get('endereco','') or '')[:46]}")
    print(f"\n> REPARSE {len(cands)} sócios | match {n['match']} | CPF {n['cpf']} | "
          f"end {n['end']} | TEL {n['tel']} | email {n['mail']}")


def main():
    ap = argparse.ArgumentParser(description="Projudi skip-trace (PR)")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dump", action="store_true")
    ap.add_argument("--inspect", action="store_true")
    ap.add_argument("--cdp", action="store_true", help="conecta no Chrome real (login A3 via CDP)")
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--sample", metavar="NOME")
    ap.add_argument("--reparse", metavar="JSONL")
    args = ap.parse_args()

    if args.reparse:
        return reparse_main(args.reparse)
    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.")
    if args.inspect:
        return inspect(args.sample, cdp=args.cdp, port=args.port)
    run(args.limit, args.dry_run, args.dump, cdp=args.cdp, port=args.port)


if __name__ == "__main__":
    main()
