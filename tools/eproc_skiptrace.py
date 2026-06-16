# -*- coding: utf-8 -*-
"""
eproc_skiptrace.py — enriquece CONTATO dos sócios (RS, SC) a partir do eproc
(TJRS/TJSC), reusando a SESSÃO LOGADA (certificado A3) no próprio browser.

POR QUÊ UM SCRIPT SEPARADO DO PJe: TJRS e TJSC NÃO usam PJe — usam o eproc
(sistema do TRF4). O PR também abandonou o PJe (virou Projudi/eproc). O DOM e o
fluxo de busca do eproc são diferentes do PJe (Seam), então os SELETORES mudam.
MAS o miolo valioso — extrair CPF/endereço/telefone da petição e CONFERIR pela
máscara do QSA — é AGNÓSTICO de sistema: reusamos `parse_qualificacao`,
`cpf_confere`, `parece_pj` do pje_rn_skiptrace (sem duplicar regex caçado a dedo).

FLUXO (por sócio), idêntico em espírito ao RN:
  1. Consulta por "Nome da parte" no eproc → lista de processos.
  2. Abre os autos → primeiro documento (petição/inicial) → lê o texto.
  3. parse_qualificacao + confere CPF pela máscara → grava só no match.
  4. Marca observacoes 'eproc/TJXX' (resumível; pula quem já tem).

⚠️ SELETORES A CALIBRAR (1 passada): o eproc é PHP (não Seam). Os IDs/seletores
abaixo (SEL_*) são o melhor palpite a partir da estrutura padrão do eproc; rode
`--inspect` UMA vez (loga, tira screenshot + dump do HTML da tela de busca e de
um processo) pra ajustar SEL_NOME/SEL_PESQUISAR/SEL_DOC/SEL_TEXTO. Depois disso
o lote roda igual ao RN. Mesmo workflow offline: `--dump`/`--reparse`.

USO:
  python tools/eproc_skiptrace.py --tj rs --inspect          # calibra seletores
  python tools/eproc_skiptrace.py --tj rs --limit 30 --dry-run
  python tools/eproc_skiptrace.py --tj rs --limit 150        # grava
  python tools/eproc_skiptrace.py --tj sc --limit 150
  python tools/eproc_skiptrace.py --reparse eproc_rs_dump.jsonl   # afina offline
"""
import os, sys, re, csv, json, time, argparse, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

# Reusa o parser batalha-testado do RN (regex de CPF/end/tel, confronto de máscara,
# detecção de PJ, cliente Supabase). NÃO reescrever — é o ativo do projeto.
from tools.pje_rn_skiptrace import (  # noqa: E402
    sb, parse_qualificacao, cpf_confere, parece_pj, RE_CPF, avaliar_socio,
)

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# ---------------------------------------------------------------------------
# Config por tribunal (eproc 1º grau). consulta_publica funciona sem login p/
# dados básicos, mas a busca por NOME completa exige a sessão de advogado (A3).
# ---------------------------------------------------------------------------
TJ = {
    "rs": {
        "uf": "RS", "nome": "TJRS",
        "base": "https://eproc1g.tjrs.jus.br/eproc/",
        "marker": "eproc/TJRS",
    },
    "sc": {
        "uf": "SC", "nome": "TJSC",
        "base": "https://eproc1g.tjsc.jus.br/eproc/",
        "marker": "eproc/TJSC",
    },
    "sp": {
        "uf": "SP", "nome": "TJSP",
        "base": "https://eproc1g.tjsp.jus.br/eproc/",
        "marker": "eproc/TJSP",
        # NB: TJSP roda eproc (novo) + e-SAJ (legado). O eproc só tem processos
        # mais recentes; casos antigos de SP podem estar no e-SAJ (scraper à parte).
    },
    # TRF4 (Justiça Federal RS/SC/PR): consulta pública SEM captcha/login — usado
    # p/ TESTAR a mecânica do scraper eproc end-to-end (mesma engine do estadual).
    # NB: só tem processos FEDERAIS (não acha os sócios, que estão na Justiça
    # ESTADUAL); serve p/ validar busca/seletores/parsing, não p/ enriquecer.
    "trf4": {
        "uf": "--", "nome": "TRF4",
        "base": "https://consulta.trf4.jus.br/trf4/controlador.php?acao=consulta_processual_pesquisa",
        "marker": "eproc/TRF4", "public": True,
    },
}

# --- SELETORES (extraídos do HTML real do eproc/TRF4 em 15/06; o eproc estadual
#     RS/SC usa o MESMO codebase, então estes ids devem bater. Confirme c/ --inspect
#     se algo falhar — a consulta eproc é: aceita LGPD -> escolhe "Nome da Parte"
#     no selForma -> digita no txtValor -> clica Pesquisar). -----------------
SEL_LGPD = "#btnAceitoPoliticaPrivacidade"            # botão "Aceito" (consentimento LGPD)
SEL_FORMA = "#selFormaI, select[name='selForma']"      # tipo de consulta (value 'NO'=Nome da Parte)
SEL_VALOR = "#txtValorI, input[name='txtValor']"       # campo onde se digita o nome
SEL_PESQUISAR = "#botaoEnviar, input[value*='Pesquisar']"
# detecta "estou na tela de consulta" (qualquer um dos campos acima presente):
SEL_NOME = SEL_VALOR
# link p/ o 1º documento dentro dos autos (eproc lista os eventos):
SEL_DOC = "a[href*='acessar_documento'], a[href*='documento'], a[onclick*='documento'], table a"
# onde o texto do documento aparece (eproc renderiza PDF em iframe OU HTML inline):
SEL_TEXTO_IFRAME = "iframe"
FORMA_NOME = "NO"   # value da option "Nome da Parte" no selForma


def cfg(tj):
    if tj not in TJ:
        sys.exit(f"ERRO: --tj deve ser um de {list(TJ)} (PR usa Projudi, não eproc)")
    return TJ[tj]


# ---------------------------------------------------------------------------
# Alvos: sócios PF do estado sem enriquecimento eproc (resume pelo marcador)
# ---------------------------------------------------------------------------
def ledger_path(tj):
    return ROOT / f"eproc_{tj}_ledger.jsonl"


def ledger_nomes(tj):
    s, p = set(), ledger_path(tj)
    if p.exists():
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line:
                try:
                    s.add((json.loads(line).get("nome") or "").upper())
                except Exception:
                    pass
    return s


def ledger_add(tj, nome, mask, result, flags=""):
    with open(ledger_path(tj), "a", encoding="utf-8") as f:
        f.write(json.dumps({"nome": nome, "mask": mask, "result": result,
                            "flags": flags}, ensure_ascii=False) + "\n")


def carregar_socios(tj, limit):
    """Sócios PF do estado ainda não varridos (ledger), não enriquecidos (marker)
    e não-PJ. Pagina o banco até juntar `limit`."""
    c = cfg(tj)
    q = ("empresa_contatos?select=id,empresa_id,nome,cpf_mascarado,telefone,email,"
         "observacoes,empresas!inner(uf)&papel=eq.socio&cpf_mascarado=not.is.null"
         f"&cpf_mascarado=like.*%2A*&empresas.uf=eq.{c['uf']}&order=nome.asc")
    done = ledger_nomes(tj)
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
            if c["marker"] in (r.get("observacoes") or ""):
                continue
            if parece_pj(nome):
                continue
            vistos.add(up)
            alvos.append(r)
            if len(alvos) >= limit:
                break
    return alvos


# ---------------------------------------------------------------------------
# Browser (Playwright) — reusa a sessão logada A3, perfil próprio por sistema
# ---------------------------------------------------------------------------
def _profile(tj):
    return str(ROOT / f".eproc-{tj}-chrome-profile")


def _ctx_cdp(p, port):
    """Conecta no Chrome REAL do usuário (já aberto com --remote-debugging-port).
    Resolve o login Keycloak+A3 que o Chromium do Playwright não consegue: o A3
    funciona nativamente no Chrome normal (cert store do Windows). Retorna (browser, ctx)."""
    browser = p.chromium.connect_over_cdp(f"http://localhost:{port}")
    if not browser.contexts:
        raise RuntimeError("CDP conectou mas não há contexto/aba. Abra uma aba no Chrome.")
    return browser, browser.contexts[0]


def aguardar_login(ctx, base):
    """Espera até a busca por parte estar acessível (logado). Não navega enquanto
    a URL ainda é de login/SSO. Até ~10 min. Retorna a page logada."""
    LOGIN = _LOGIN_MARK  # mesmos marcadores específicos (evita casar "sso" em "processo")
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        page.goto(base, wait_until="domcontentloaded", timeout=60000)
    except Exception:
        pass
    print(">>> Faça LOGIN no eproc com o A3 na janela do Chrome que abriu.", flush=True)
    print(">>> Aguardando autenticação (campo de consulta por parte aparecer)...", flush=True)
    for it in range(300):  # ~10 min
        for pg in list(ctx.pages):
            try:
                _aceitar_lgpd(pg)  # o modal LGPD pode esconder o form
                if pg.query_selector(SEL_VALOR):
                    return pg
            except Exception:
                pass
        # tenta navegar abas que já saíram da tela de login
        for pg in list(ctx.pages):
            u = (pg.url or "").lower()
            if "eproc" in u and not any(m in u for m in LOGIN):
                try:
                    pg.goto(base, wait_until="domcontentloaded", timeout=30000)
                    pg.wait_for_timeout(1200)
                    _aceitar_lgpd(pg)
                    if pg.query_selector(SEL_VALOR):
                        return pg
                except Exception:
                    pass
        time.sleep(2)
    return None


def _aceitar_lgpd(page):
    """Clica no 'Aceito' da política de privacidade (LGPD) se estiver presente."""
    try:
        el = page.query_selector(SEL_LGPD)
        if el and el.is_visible():
            el.click()
            page.wait_for_timeout(600)
    except Exception:
        pass


# --- Consulta AUTENTICADA do eproc (logado via A3/CDP) — descoberta no TJSP:
#     a tela acao=processo_consultar tem campo #strNomeParte (name da parte),
#     #sbmConsultar (botão). O campo vem disabled (controlado por critério); o
#     scraper força-habilita via JS e preenche. Diferente do form PÚBLICO
#     (selForma/txtValor, com captcha). ----------------------------------------
SEL_CONSULTA_LINK = (r"a[href*='processo_consultar'], a[href*='processo_consulta'], "
                     r"a[href*='consulta_processual']")
# critério de pesquisa: select com options NU/NO/CP/OA... — escolher "NO" (Nome da
# Parte) mostra/habilita o divSet data-campoparaopcao="NO,SN" com o strNomeParte.
SEL_TIPO_PESQUISA = "#selTipoPesquisa, select[name='tipoPesquisa']"
TIPO_NOME = "NO"
SEL_NOME_PARTE = "#strNomeParte, input[name='strNomeParte']"
SEL_SBM_CONSULTAR = "#sbmConsultar, input[name='sbmConsultar']"


def _ir_para_consulta(page):
    """Navega da home/painel autenticado p/ a tela de Consultar Processos."""
    if page.query_selector(SEL_NOME_PARTE):
        return True
    for f in page.frames:
        try:
            href = f.evaluate(r"""() => {
              const a=[...document.querySelectorAll('a')].find(x=>
                /processo_consultar|consulta_processual|processo_consulta/.test(x.getAttribute('href')||''));
              return a ? a.getAttribute('href') : null;
            }""")
            if href:
                root = page.url.split("/controlador.php")[0] + "/"
                full = href if href.startswith("http") else root + href.lstrip("/")
                page.goto(full, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(1500)
                return bool(page.query_selector(SEL_NOME_PARTE))
        except Exception:
            pass
    return bool(page.query_selector(SEL_NOME_PARTE))


def pesquisar(page, base, nome):
    """Busca por nome da parte no eproc AUTENTICADO. Retorna [{proc, idx, texto}].
    Fluxo: tela processo_consultar -> selTipoPesquisa='NO' (Nome da Parte; mostra/
    habilita o campo) -> preenche strNomeParte -> Consultar."""
    if not _ir_para_consulta(page):
        raise RuntimeError("sessao expirada/consulta indisponivel (consulta ausente)")
    # 1) escolhe o critério "Nome da Parte" (dispara o JS que mostra o divSet)
    try:
        page.select_option(SEL_TIPO_PESQUISA, TIPO_NOME)
        page.wait_for_timeout(800)
    except Exception:
        pass
    # 2) preenche o nome. Se ainda vier disabled/oculto, força via JS + eventos.
    try:
        page.fill(SEL_NOME_PARTE, nome, timeout=8000)
    except Exception:
        page.eval_on_selector(SEL_NOME_PARTE, """(el, v) => {
          el.disabled = false; el.value = v;
          el.dispatchEvent(new Event('input', {bubbles:true}));
          el.dispatchEvent(new Event('change', {bubbles:true}));
        }""", nome)
    # 3) submete (botão Consultar); fallback em JS click
    try:
        page.click(SEL_SBM_CONSULTAR, timeout=8000)
    except Exception:
        page.eval_on_selector(SEL_SBM_CONSULTAR, "el => el.click()")
    page.wait_for_timeout(3000)
    # lê linhas com número CNJ (varre todos os frames — eproc pode usar iframe)
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
    seen, uniq = set(), []
    for r in out:
        if r["proc"] not in seen:
            seen.add(r["proc"]); uniq.append(r)
    return uniq


def abrir_e_extrair(page, proc):
    """Abre os autos do processo e extrai o texto do 1º documento (petição)."""
    ctx = page.context
    # eproc costuma abrir os autos na MESMA aba ou em popup; cobre os dois.
    novo = None
    try:
        with ctx.expect_page(timeout=8000) as pinfo:
            page.evaluate("""(proc) => {
              const tr=[...document.querySelectorAll('table tr')].find(t=>t.innerText.includes(proc));
              const a=tr && tr.querySelector('a');
              if(a) a.click();
            }""", proc)
        novo = pinfo.value
    except Exception:
        novo = page  # abriu na mesma aba
    autos = novo
    autos.wait_for_load_state("domcontentloaded")
    autos.wait_for_timeout(2000)
    # tenta abrir o 1º documento da lista de eventos
    try:
        autos.click(SEL_DOC, timeout=6000)
        autos.wait_for_timeout(2000)
    except Exception:
        pass
    # extrai texto: tenta iframe PDF.js, senão innerText da página
    txt = ""
    for k in range(14):
        txt = autos.evaluate(r"""() => {
          const ifr=[...document.querySelectorAll('iframe')].find(f=>/pdf|viewer|documento/.test(f.src||''));
          if(ifr){ try{ const d=ifr.contentDocument; if(d){
            let t=''; d.querySelectorAll('.textLayer').forEach(l=>t+=l.innerText+'\n');
            if(t) return t; return d.body?d.body.innerText:''; } }catch(e){} }
          return document.body ? document.body.innerText : '';
        }""")
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


def gravar(tj, socio, q):
    """Atualiza o contato no CRM, escopado por nome E máscara (não pisa homônimo)."""
    c = cfg(tj)
    nome = socio["nome"]
    obs = (f"{c['marker']} (proc {q.get('proc','')}): "
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
# Modo --inspect: 1 passada pra calibrar seletores (loga, screenshot + HTML)
# ---------------------------------------------------------------------------
def _snapshot_campos(page):
    """Lista inputs/selects/options/botões da página (p/ confirmar seletores)."""
    return page.evaluate(r"""() => {
      const inp=[...document.querySelectorAll('input')].map(e=>({
        tag:'input', id:e.id, name:e.name, type:e.type, ph:e.placeholder}));
      const sel=[...document.querySelectorAll('select')].map(e=>({
        tag:'select', id:e.id, name:e.name,
        options:[...e.options].map(o=>({value:o.value, txt:o.text.trim()})).slice(0,15)}));
      const btn=[...document.querySelectorAll('button,input[type=submit],input[type=button]')]
        .map(e=>({tag:e.tagName, id:e.id, name:e.name, val:e.value, txt:(e.innerText||'').slice(0,30)}));
      return {inputs: inp.slice(0,40), selects: sel, buttons: btn.slice(0,30)};
    }""")


# marcadores de tela de LOGIN/SSO — específicos p/ NÃO casar dentro de palavras
# legítimas da URL autenticada (ex: "sso" casava em "proceSSO_consultar"! bug 15/06).
_LOGIN_MARK = ("sso.", "/login", "login.", "openid-connect", "keycloak",
               "saml", "realms/", "idp_hint", "certificad")


def _logado_eproc(pg):
    """Detecta sessão autenticada SEM depender dos seletores da consulta:
    URL do eproc fora da tela de login + sinais de menu autenticado no texto."""
    u = (pg.url or "").lower()
    if "eproc" not in u or any(m in u for m in _LOGIN_MARK):
        return False
    # controlador interno (autenticado) já basta; senão procura o menu no texto
    if "controlador.php" in u and "externo" not in u:
        return True
    try:
        for f in pg.frames:
            t = f.inner_text("body") or ""
            if "Consulta Processual" in t or ("Sair" in t and "Painel" in t):
                return True
    except Exception:
        pass
    return False


def _dump_frames(page, tag):
    """Salva HTML+screenshot da página e lista links/campos de TODOS os frames —
    foco nos links que parecem 'Consulta Processual' (pra mapear a navegação)."""
    try:
        (ROOT / f"eproc_disc_{tag}.html").write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(ROOT / f"eproc_disc_{tag}.png"), full_page=True)
    except Exception:
        pass
    for i, f in enumerate(page.frames):
        try:
            info = f.evaluate(r"""() => ({
              url: location.href,
              links: [...document.querySelectorAll('a')].map(a=>({
                txt:(a.innerText||'').trim().slice(0,45),
                href:(a.getAttribute('href')||'').slice(0,90),
                onclick:(a.getAttribute('onclick')||'').slice(0,70)})).filter(l=>l.txt||l.href).slice(0,80),
              fields: [...document.querySelectorAll('input,select')].map(e=>({
                tag:e.tagName, id:e.id, name:e.name, type:e.type})).slice(0,30)
            })""")
        except Exception:
            continue
        if not (info.get("links") or info.get("fields")):
            continue
        print(f"  frame[{i}] {info['url'][:75]}", flush=True)
        cl = [l for l in info["links"]
              if re.search(r"consult|processo|parte|pesquis|partes", l["txt"] + l["href"] + l["onclick"], re.I)]
        if cl:
            print("    consulta-links:", json.dumps(cl, ensure_ascii=False)[:700], flush=True)
        if info["fields"]:
            print("    fields:", json.dumps(info["fields"], ensure_ascii=False)[:600], flush=True)


def test_publico(tj, sample, headless=True):
    """Testa a MECÂNICA do scraper eproc contra uma consulta PÚBLICA (TRF4) — sem
    login/A3. Valida: aceite LGPD, select 'Nome da Parte', busca, parsing das linhas
    de resultado e abertura do 1º processo. NÃO enriquece (dados federais)."""
    from playwright.sync_api import sync_playwright
    c = cfg(tj)
    sample = sample or "MARIA DA SILVA"
    print(f">>> TESTE PÚBLICO {c['nome']} (headless={headless}) — busca: '{sample}'", flush=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            _profile(tj), headless=headless, viewport={"width": 1280, "height": 900})
        ctx.on("page", lambda pg: pg.on("dialog", lambda d: d.accept()))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(c["base"], wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1500)
        _aceitar_lgpd(page)
        # snapshot do form (confirma SEL_FORMA/VALOR)
        print(">>> [1/3] Campos do form:", flush=True)
        try:
            print("   " + json.dumps(_snapshot_campos(page), ensure_ascii=False)[:700], flush=True)
        except Exception as e:
            print(f"   (erro snapshot: {e})", flush=True)
        (ROOT / f"eproc_{tj}_consulta.html").write_text(page.content(), encoding="utf-8")
        # busca
        print(f">>> [2/3] Buscando '{sample}'...", flush=True)
        rows = []
        try:
            rows = pesquisar(page, c["base"], sample)
            print(f"   {len(rows)} processos encontrados.", flush=True)
            for r in rows[:5]:
                print(f"     - {r['proc']} | {r['texto'][:60]}", flush=True)
            (ROOT / f"eproc_{tj}_resultados.html").write_text(page.content(), encoding="utf-8")
        except Exception as e:
            print(f"   ERRO na busca: {e}", flush=True)
        # abre 1º processo
        if rows:
            print(f">>> [3/3] Abrindo {rows[0]['proc']}...", flush=True)
            try:
                txt = abrir_e_extrair(page, rows[0]["proc"])
                cpf = "SIM" if RE_CPF.search(txt or "") else "nao"
                print(f"   texto extraído: {len(txt or '')} chars | tem CPF: {cpf}", flush=True)
                if txt:
                    print(f"   amostra: {txt[:200].strip()}", flush=True)
            except Exception as e:
                print(f"   ERRO ao abrir/extrair: {e}", flush=True)
        ctx.close()
    print(">>> Teste concluído. (snapshots eproc_%s_*.html)" % tj, flush=True)


def inspect(tj, sample=None, cdp=False, port=9222):
    """MODO DESCOBERTA: aguarda login (por URL/menu, NÃO pelo form), dumpa a sessão
    autenticada (home + links + frames + campos) pra mapear o caminho da consulta.
    Tenta achar/clicar 'Consulta Processual' e re-dumpa. Salva tudo em eproc_disc_*.

    cdp=True: conecta no Chrome REAL do usuário (--remote-debugging-port) — resolve
    o login Keycloak+A3 que o Chromium do Playwright não consegue apresentar."""
    from playwright.sync_api import sync_playwright
    c = cfg(tj)
    with sync_playwright() as p:
        browser = None
        if cdp:
            browser, ctx = _ctx_cdp(p, port)
            print(f">>> Conectado ao Chrome real via CDP (porta {port}).", flush=True)
            print(f">>> Abra o eproc-{tj.upper()} ({c['base']}) e LOGUE com o A3 nesse Chrome.", flush=True)
        else:
            ctx = p.chromium.launch_persistent_context(
                _profile(tj), headless=False, viewport={"width": 1280, "height": 900})
            ctx.on("page", lambda pg: pg.on("dialog", lambda d: d.accept()))
            page0 = ctx.pages[0] if ctx.pages else ctx.new_page()
            try:
                page0.goto(c["base"], wait_until="domcontentloaded", timeout=60000)
            except Exception:
                pass
            print(">>> Faça LOGIN no eproc-" + tj.upper() + " com o A3 na janela do Chrome.", flush=True)
        print(">>> (detecto o login automaticamente — SEM PRESSA, espero ~40 min)", flush=True)
        page_log = None
        for it in range(1200):  # ~40 min
            for pg in list(ctx.pages):
                try:
                    _aceitar_lgpd(pg)
                    if _logado_eproc(pg):
                        page_log = pg
                        break
                except Exception:
                    pass
            if page_log:
                break
            if it % 8 == 7:
                urls = []
                for pg in list(ctx.pages):
                    try:
                        urls.append((pg.url or "")[:90])
                    except Exception:
                        pass
                print(f"   [{it*2}s] abas: {urls}", flush=True)

        if not page_log:
            print("Timeout aguardando login (~40 min). Saindo.", flush=True)
            if not cdp:
                ctx.close()
            return
        page = page_log
        print(f">>> Autenticado! URL: {page.url}", flush=True)

        # 1) dump da HOME autenticada (acha o link da consulta)
        print("\n>>> [1/2] Sessão autenticada (procurando link de Consulta Processual):", flush=True)
        _dump_frames(page, "home")

        # 2) navega à consulta por nome. PRIORIZA o link real (acao=processo_consultar)
        #    sobre o toggle do dropdown ('Consulta Processual' tem href='#').
        print("\n>>> [2/2] Tentando abrir a Consulta Processual...", flush=True)
        clicou = False
        # 2a) acha o href real do "Consultar Processos" e navega direto (mais robusto)
        for f in page.frames:
            try:
                href = f.evaluate(r"""() => {
                  const a=[...document.querySelectorAll('a')].find(x=>
                    /processo_consultar|consulta_processual|processo_consulta/.test(x.getAttribute('href')||''));
                  return a ? a.getAttribute('href') : null;
                }""")
                if href:
                    base_root = page.url.split("/controlador.php")[0] + "/"
                    full = href if href.startswith("http") else base_root + href.lstrip("/")
                    page.goto(full, wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_timeout(2000)
                    clicou = True
                    print(f"    -> naveguei p/ {href[:60]}", flush=True)
                    break
            except Exception:
                pass
        # 2b) fallback: clica por texto
        if not clicou:
            for f in page.frames:
                try:
                    el = f.query_selector("a:has-text('Consultar Processos'), a[href*='consulta']")
                    if el:
                        el.click(); page.wait_for_timeout(2500); clicou = True; break
                except Exception:
                    pass
        if clicou:
            _aceitar_lgpd(page)
            _dump_frames(page, "consulta")
            # mostra os campos/selects do form de consulta (p/ confirmar SEL_*)
            try:
                print("  campos do form:", json.dumps(_snapshot_campos(page), ensure_ascii=False)[:900], flush=True)
            except Exception:
                pass
        else:
            print("  (não achei link óbvio de consulta — veja eproc_disc_home.html/.png)", flush=True)

        print("\n>>> Snapshots salvos: eproc_disc_home.* e eproc_disc_consulta.* (na raiz do projeto)", flush=True)
        if sys.stdin.isatty():
            input(">>> ENTER pra fechar (ou navegue no Chrome até a consulta e veja o HTML).")
        else:
            page.wait_for_timeout(4000)
        # NUNCA fechar o Chrome do usuário no modo CDP — sair do `with sync_playwright`
        # já desconecta sem matar o navegador (browser.close() FECHARIA as abas).
        if not cdp:
            ctx.close()


# ---------------------------------------------------------------------------
# Lote principal
# ---------------------------------------------------------------------------
def _aguardar_login_qualquer(ctx, base):
    """Espera a sessão eproc logada em qualquer aba (usa _logado_eproc). Se não
    houver aba do eproc, navega UMA aba até a base (o cookie do perfil pode já
    estar autenticado → restaura a sessão sem novo login)."""
    navegou = False
    for it in range(1200):  # ~40 min
        for pg in list(ctx.pages):
            try:
                _aceitar_lgpd(pg)
                if _logado_eproc(pg):
                    return pg
            except Exception:
                pass
        # se nenhuma aba está no eproc, leva uma aba pra base (1x) p/ tentar o cookie
        if not navegou:
            tem_eproc = any("eproc" in (pg.url or "").lower() for pg in ctx.pages)
            if not tem_eproc:
                try:
                    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
                    pg.goto(base, wait_until="domcontentloaded", timeout=30000)
                    navegou = True
                except Exception:
                    pass
        time.sleep(2)
    return None


def run(tj, limit, dry, dump, cdp=False, port=9222):
    from playwright.sync_api import sync_playwright
    c = cfg(tj)
    dump_path = ROOT / f"eproc_{tj}_dump.jsonl"
    alvos = carregar_socios(tj, limit)
    print(f"> {len(alvos)} sócios {c['uf']} a processar (PF, sem enriquecimento {c['marker']}).")
    if not alvos:
        return
    out_csv = ROOT / f"eproc_{tj}_skiptrace.csv"
    resultados = []
    with sync_playwright() as p:
        browser = None
        if cdp:
            browser, ctx = _ctx_cdp(p, port)
            print(f">>> CDP (porta {port}). Aguardando sessão eproc-{tj.upper()} logada...", flush=True)
            page = _aguardar_login_qualquer(ctx, c["base"])
        else:
            ctx = p.chromium.launch_persistent_context(
                _profile(tj), headless=False, viewport={"width": 1280, "height": 900})
            ctx.on("page", lambda pg: pg.on("dialog", lambda d: d.accept()))
            page = aguardar_login(ctx, c["base"])
        if not page:
            print("Timeout aguardando login. Saindo.")
            if not cdp:
                ctx.close()
            return
        print(">>> Autenticado. Iniciando varredura.", flush=True)
        if dump and dump_path.exists():
            dump_path.unlink()
        erros = 0              # falhas seguidas na BUSCA (form ausente = sessão caiu)
        aberturas_falhas = 0   # sócios seguidos com processos mas NENHUM autos abriu
        enriquecidos = 0       # hits efetivamente gravados neste lote
        LIMITE_ABERTURA = 5    # autos não abrem N× seguidas = limite diário do tribunal
        for i, s in enumerate(alvos, 1):
            nome, mask = s["nome"], s["cpf_mascarado"]
            try:
                rows = pesquisar(page, c["base"], nome)
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
                    ledger_add(tj, nome, mask, "sem_processo")
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
                    with open(dump_path, "a", encoding="utf-8") as df:
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
                        gravar(tj, s, got)
                    except Exception as e:
                        print(f"     (falha ao gravar {nome[:20]}: {str(e)[:40]})")
                        time.sleep(1); continue
                enriquecidos += 1
            if not dry:
                ledger_add(tj, nome, mask, "hit" if got else "sem_match", flags)
            print(f"[{i}/{len(alvos)}] {nome[:30]:30} {len(rows)} proc -> {flags or 'sem match'}")
            time.sleep(0.5)
        if not cdp:
            ctx.close()  # CDP: não fechar — sair do `with` desconecta sem matar o Chrome
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        if resultados:
            w = csv.DictWriter(f, fieldnames=list(resultados[0].keys()))
            w.writeheader(); w.writerows(resultados)
    com_tel = sum(1 for r in resultados if r.get("telefone"))
    grav = enriquecidos if not dry else 0
    print(f"\n> {len(resultados)} sócios com match (telefone:{com_tel}) | {grav} gravados no CRM. CSV: {out_csv.name}")


def reparse_main(path):
    """Roda o parser sobre um corpus salvo (--dump) — sem browser. Reusa avaliar_socio."""
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
    ap = argparse.ArgumentParser(description="eproc skip-trace (RS, SC)")
    ap.add_argument("--tj", choices=list(TJ), help="rs | sc")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dump", action="store_true", help="salva texto cru p/ reparse offline")
    ap.add_argument("--inspect", action="store_true", help="loga e dumpa a tela p/ calibrar seletores")
    ap.add_argument("--public", action="store_true", help="testa contra consulta pública (TRF4) sem login/A3")
    ap.add_argument("--headed", action="store_true", help="com --public: abre o browser visível (default headless)")
    ap.add_argument("--cdp", action="store_true", help="conecta no Chrome real (--remote-debugging-port) p/ login A3 Keycloak")
    ap.add_argument("--port", type=int, default=9222, help="porta CDP do Chrome (default 9222)")
    ap.add_argument("--sample", metavar="NOME", help="nome p/ a busca de teste (--inspect/--public)")
    ap.add_argument("--reparse", metavar="JSONL", help="reprocessa corpus salvo (sem browser)")
    args = ap.parse_args()

    if args.reparse:
        return reparse_main(args.reparse)
    # teste público (TRF4) não precisa de Supabase nem A3
    if args.public:
        if not args.tj:
            args.tj = "trf4"
        return test_publico(args.tj, args.sample, headless=not args.headed)
    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.")
    if not args.tj:
        sys.exit("ERRO: informe --tj rs|sc (PR usa Projudi — script à parte).")
    if args.inspect:
        return inspect(args.tj, args.sample, cdp=args.cdp, port=args.port)
    run(args.tj, args.limit, args.dry_run, args.dump, cdp=args.cdp, port=args.port)


if __name__ == "__main__":
    main()
