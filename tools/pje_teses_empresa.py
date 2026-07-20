# -*- coding: utf-8 -*-
"""
pje_teses_empresa.py — dado o CNPJ de uma empresa, descobre no PJe-TJRN (1º e 2º
grau) QUAIS TESES TRIBUTÁRIAS ela já ajuizou, pra saber quais o escritório ainda
pode oferecer (gap = catálogo de teses − teses já ajuizadas).

COMO (barato): a consulta do PJe já traz CLASSE e ASSUNTO na LISTA de resultados
— então classificamos SEM abrir os autos (não gasta o limite diário do TJRN).
Só a busca é usada. 1º e 2º grau do MESMO processo compartilham o número CNJ
unificado (NNNNNNN-DD.AAAA.J.TR.OOOO) → dedup por número.

FILTROS (definidos pelo usuário):
  - CLASSE incompatível com tese tributária (penal, família, consumidor, cobrança
    cível comum, etc.) → descartada.
  - ASSUNTO diverso (não-tributário) → descartado.
  - Sobra: processos tributários, deduplicados, classificados por tese.

Reusa a sessão A3 logada no perfil .pje-chrome-profile (mesmo do skiptrace).

USO:
  . tools\\pje-env.local.ps1
  python tools/pje_teses_empresa.py --cnpj 01.611.866/0001-00 --inspect   # 1ª vez: dump da estrutura real
  python tools/pje_teses_empresa.py --cnpj 01.611.866/0001-00             # análise
"""
import os, sys, re, json, time, argparse
import urllib.request, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
PROFILE = str(ROOT / ".pje-chrome-profile")

# Graus do TJRN (mesmo caminho Seam, hosts diferentes). 2g = recursos/apelações.
GRAUS = {
    "1g": "https://pje1g.tjrn.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
    "2g": "https://pje2g.tjrn.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
}
RE_PROC = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")


# ---------------------------------------------------------------------------
# Supabase REST (o CLI anda instável nesta máquina; REST é confiável)
# ---------------------------------------------------------------------------
def sb(path):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# Classificação — CLASSE e ASSUNTO
# ---------------------------------------------------------------------------
# Classes JUDICIAIS incompatíveis com tese tributária (descarta na hora).
CLASSES_FORA = [
    "PENAL", "CRIME", "CRIMINAL", "INQUERITO", "HABEAS CORPUS", "EXECUCAO PENAL",
    "DIVORCIO", "ALIMENTOS", "GUARDA", "INVENTARIO", "ARROLAMENTO", "TUTELA",
    "CURATELA", "ADOCAO", "UNIAO ESTAVEL", "FAMILIA",
    "DESPEJO", "LOCACAO", "USUCAPIAO", "POSSESS", "REINTEGRACAO", "BUSCA E APREENSAO",
    "ALIENACAO FIDUCIARIA", "MONITORIA", "DESPEJO",
    "TRABALH", "RECLAMACAO TRABALHISTA",
    "CONSUMIDOR", "JUIZADO ESPECIAL",  # JEC ~ relação de consumo, não tese trib.
    "COBRANCA", "EXECUCAO DE TITULO EXTRAJUDICIAL", "MONITORIA", "INDENIZA",
    "ACIDENTE", "SEGURO", "PREVIDENC", "APOSENTADORIA", "BENEFICIO",
    "FALENCIA", "RECUPERACAO JUDICIAL", "INSOLVENCIA",
]
# Classes tipicamente usadas em tese tributária (empresa como POLO ATIVO).
CLASSES_TRIB = [
    "MANDADO DE SEGURANCA", "PROCEDIMENTO COMUM", "ACAO ORDINARIA",
    "DECLARATORIA", "ANULATORIA", "REPETICAO DE INDEBITO", "CONSIGNACAO",
    "EMBARGOS A EXECUCAO FISCAL", "EMBARGOS A EXECUCAO", "EXECUCAO FISCAL",
    "CAUTELAR", "TUTELA CAUTELAR", "TUTELA ANTECIPADA", "CUMPRIMENTO DE SENTENCA",
]
# Palavras que marcam ASSUNTO tributário (CNJ "Direito Tributário").
ASSUNTO_TRIB = [
    "TRIBUT", "IMPOSTO", "ICMS", "ISS", "ISSQN", "IPTU", "ITBI", "ITCMD", "IPVA",
    "IPI", "IRPJ", "IRPF", "IMPOSTO DE RENDA", "CSLL", "PIS", "PASEP", "COFINS",
    "CONTRIBUICAO", "CREDITO PRESUMIDO", "SUBVENCAO", "INCENTIVO FISCAL",
    "TAXA", "DIVIDA ATIVA", "EXECUCAO FISCAL", "CERTIDAO", "CND", "REFIS",
    "PARCELAMENTO", "COMPENSACAO", "RESTITUICAO", "REPETICAO DE INDEBITO",
    "BASE DE CALCULO", "ALIQUOTA", "SIMPLES NACIONAL", "DIFAL", "SUBSTITUICAO TRIBUTARIA",
    "RAT", "SAT", "GILRAT", "FGTS", "INSS", "TERCO DE FERIAS", "TERCO CONSTITUCIONAL",
]

# Mapa ASSUNTO/texto -> tese do catálogo (regras: precisa de TODOS os termos "all"
# e de pelo menos um "any"). Best-effort a partir do assunto da lista; a tese
# exata pode exigir os autos, mas o assunto já indica forte.
def regras_tese():
    return [
        ("EXCLUSÃO DO PIS E DA COFINS DA SUA BASE DE CÁLCULO",
         {"any": ["ICMS BASE", "EXCLUSAO ICMS", "ICMS DA BASE", "BASE DE CALCULO PIS", "PIS/COFINS ICMS"],
          "hint": ["PIS", "COFINS", "ICMS"]}),
        ("CREDITAMENTO DE PIS E COFINS SOBRE O ICMS NA AQUISIÇÃO DE MERCADORIAS",
         {"hint": ["CREDIT", "PIS", "COFINS", "ICMS", "AQUISICAO"]}),
        ("NÃO TRIBUTAÇÃO DOS INCENTIVOS FISCAIS DE ICMS PELO IRPJ, CSLL, PIS E COFINS",
         {"any": ["INCENTIVO FISCAL", "SUBVENCAO", "BENEFICIO FISCAL"], "hint": ["ICMS"]}),
        ("EXCLUSÃO DA INCIDÊNCIA DO IRPJ E DA CSLL SOBRE OS CRÉDITOS PRESUMIDOS DE ICMS",
         {"all": ["CREDITO PRESUMIDO"], "hint": ["ICMS", "IRPJ", "CSLL"]}),
        ("REDUÇÃO ALÍQUOTA RAT BASEADO NA ATIVIDADE PREPONDERANTE",
         {"any": ["RAT", "SAT", "GILRAT", "RISCOS AMBIENTAIS"]}),
        ("MAJORAÇÃO DE 10% SOBRE O LUCRO PRESUMIDO",
         {"any": ["ADICIONAL", "MAJORACAO"], "hint": ["LUCRO PRESUMIDO", "IRPJ"]}),
        ("RESCISÓRIA DO TEMA 985 (TERÇO DE FÉRIAS)",
         {"any": ["TERCO DE FERIAS", "TERCO CONSTITUCIONAL", "TEMA 985", "1/3 DE FERIAS"]}),
        ("RECUPERAÇÃO IRRF E FOLHA PARA MUNICÍPIOS",
         {"any": ["IRRF", "IMPOSTO DE RENDA RETIDO"]}),
    ]


def _norm(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").upper())
                   if unicodedata.category(c) != "Mn")


def classe_incompativel(classe):
    c = _norm(classe)
    if any(k in c for k in CLASSES_FORA):
        return True
    # se não bate nenhuma classe tributária conhecida, é "diversa" -> fora
    return not any(k in c for k in CLASSES_TRIB)


def assunto_tributario(assunto):
    a = _norm(assunto)
    return any(k in a for k in ASSUNTO_TRIB)


def classificar_tese(assunto, classe, catalogo_norm):
    """Retorna (nome_tese_do_catalogo | None, confianca). Best-effort pelo assunto."""
    texto = _norm(assunto) + " " + _norm(classe)
    for nome, rg in regras_tese():
        if _norm(nome) not in catalogo_norm:
            continue  # tese não está no catálogo do escritório
        if "all" in rg and not all(t in texto for t in rg["all"]):
            continue
        if "any" in rg and not any(t in texto for t in rg["any"]):
            continue
        # bateu regra estrutural; hint reforça confiança
        hits = sum(1 for t in rg.get("hint", []) if t in texto)
        conf = "alta" if ("all" in rg or "any" in rg) and hits >= 1 else "media"
        return nome, conf
    return None, None


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cnpj", required=True)
    ap.add_argument("--inspect", action="store_true",
                    help="1ª vez: loga, dumpa os campos do form + linhas cruas de resultado e sai")
    ap.add_argument("--graus", default="1g,2g", help="quais graus buscar (default 1g,2g)")
    args = ap.parse_args()
    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("ERRO: rode `. tools\\pje-env.local.ps1` antes.")

    cnpj_digits = re.sub(r"\D", "", args.cnpj)
    cnpj_fmt = f"{cnpj_digits[0:2]}.{cnpj_digits[2:5]}.{cnpj_digits[5:8]}/{cnpj_digits[8:12]}-{cnpj_digits[12:14]}"

    # empresa (nome/razão social pra busca por nome como fallback) + catálogo
    emp = sb(f"empresas?select=id,nome,razao_social,uf&or=(cnpj.eq.{urllib.parse.quote(cnpj_fmt)},cnpj.eq.{cnpj_digits})")
    empresa = emp[0] if emp else None
    razao = (empresa or {}).get("razao_social") or (empresa or {}).get("nome") or ""
    catalogo = [r["nome"] for r in sb("acoes_tributarias?select=nome&status=eq.Ativa")]
    catalogo_norm = {_norm(n): n for n in catalogo}
    print(f"CNPJ {cnpj_fmt} | empresa: {razao or '(não está no CRM)'} | catálogo: {len(catalogo)} teses")

    from playwright.sync_api import sync_playwright
    graus = [g.strip() for g in args.graus.split(",") if g.strip() in GRAUS]

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(PROFILE, headless=False,
                                                    viewport={"width": 1360, "height": 940})
        def _aceitar(d):
            try: d.accept()
            except Exception: pass
        ctx.on("page", lambda pg: pg.on("dialog", _aceitar))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("dialog", _aceitar)

        SEL_FORM = "input[id*='nomeParte'], input[id*='Documento'], input[id*='cpfCnpj'], input[id*='numeroDocumento']"
        LOGIN_MARKERS = ("sso", "/login", "login.seam", "auth", "openid", "saml",
                         "keycloak", "acesso.gov", "certificado")

        todos = {}  # numero -> {proc, classe, assunto, polo, grau}
        for gi, grau in enumerate(graus):
            url = GRAUS[grau]
            try: page.goto(url, wait_until="domcontentloaded")
            except Exception: pass
            if gi == 0:
                print(f">>> Faça LOGIN no TJRN com o A3 na janela do Chrome. Aguardando... (grau {grau})", flush=True)
                # NÃO re-navega a tela de login (recarregar por baixo impede o A3).
                # Só procura o form em QUALQUER aba; se alguma já passou do login
                # mas não está na consulta, navega ESSA aba pra consulta.
                ok = False
                for _ in range(300):  # ~10 min
                    for pg in list(ctx.pages):
                        try:
                            if pg.query_selector(SEL_FORM):
                                page = pg; ok = True; break
                        except Exception:
                            pass
                    if ok: break
                    alvo = None
                    for pg in list(ctx.pages):
                        try:
                            u = (pg.url or "").lower()
                            if "tjrn.jus.br" in u and not any(m in u for m in LOGIN_MARKERS):
                                alvo = pg
                        except Exception:
                            pass
                    if alvo:
                        try: alvo.goto(url, wait_until="domcontentloaded")
                        except Exception: pass
                    page.wait_for_timeout(2000)
                if not ok:
                    print("Timeout aguardando login."); return
                print(f">>> Autenticado. Buscando {grau}...", flush=True)
            else:
                # 2º grau: sessão A3 já vale (SSO compartilhado); só garante o form
                for _ in range(20):
                    if page.query_selector(SEL_FORM): break
                    page.wait_for_timeout(1000)
                    try: page.goto(url, wait_until="domcontentloaded")
                    except Exception: pass
            page.wait_for_timeout(1000)

            if args.inspect:
                # dumpa TODOS os inputs do form (pra achar o campo de CNPJ) + a classe/assunto
                campos = page.evaluate(r"""() => [...document.querySelectorAll('input,select')]
                    .map(e => ({id:e.id, name:e.name, type:e.type, ph:e.placeholder||''}))
                    .filter(e => e.id || e.name)""")
                print(f"\n=== [{grau}] CAMPOS DO FORM ({len(campos)}) ===")
                for c in campos[:40]:
                    print("  ", c)

            # busca por CNPJ (campo documento) se existir; senão por razão social
            achou_campo = _buscar(page, cnpj_digits, razao)
            page.wait_for_timeout(800)
            linhas = page.evaluate(r"""() => {
              const out=[];
              for (const tr of document.querySelectorAll('table tr')) {
                const t = tr.innerText;
                const m = t.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
                if (!m) continue;
                const cells = [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g,' ').trim());
                out.push({proc:m[0], cells, texto:t.replace(/\s+/g,' ').trim()});
              }
              return out;
            }""")
            print(f"[{grau}] busca por {'CNPJ' if achou_campo=='doc' else 'razão social'}: {len(linhas)} linha(s)")
            if args.inspect and linhas:
                print(f"=== [{grau}] AMOSTRA DE LINHAS CRUAS (até 5) ===")
                for r in linhas[:5]:
                    print(f"  proc={r['proc']}")
                    for i, c in enumerate(r["cells"]):
                        if c: print(f"     cell[{i}]: {c[:120]}")
            for r in linhas:
                todos.setdefault(r["proc"], {**r, "grau": grau})

        if args.inspect:
            print("\n[INSPECT] fim. Ajuste os seletores/colunas e rode sem --inspect.")
            return

        # ---- classificação ----
        analisar(todos, catalogo, catalogo_norm, razao, cnpj_fmt)


def _buscar(page, cnpj_digits, razao):
    """Busca por CNPJ: seleciona o radio 'cnpj' e preenche o campo documentoParte
    (o campo real de CPF/CNPJ da parte no PJe TJRN). Fallback: Nome da Parte.
    Retorna 'doc'|'nome'|'?'."""
    cnpj_fmt = f"{cnpj_digits[0:2]}.{cnpj_digits[2:5]}.{cnpj_digits[5:8]}/{cnpj_digits[8:12]}-{cnpj_digits[12:14]}"
    radio = page.query_selector("input[id='cnpj'][name*='tipoMascaraDocumento']") or page.query_selector("input[id='cnpj']")
    doc = page.query_selector("input[id$=':documentoParte']") or page.query_selector("input[id$='documentoParte']")
    if doc:
        if radio:
            try: radio.check()
            except Exception:
                try: radio.click()
                except Exception: pass
            page.wait_for_timeout(400)
        # a máscara do campo espera o formato pontuado; .fill seta o valor direto.
        doc.fill(cnpj_fmt)
        page.wait_for_timeout(200)
        page.click("input[value='Pesquisar'], button:has-text('Pesquisar')")
        _esperar(page)
        return "doc"
    nome = page.query_selector("input[id$=':nomeParte']") or page.query_selector("input[id*='nomeParte']")
    if nome and razao:
        nome.fill(razao)
        page.click("input[value='Pesquisar'], button:has-text('Pesquisar')")
        _esperar(page)
        return "nome"
    return "?"


def _esperar(page):
    for _ in range(40):
        page.wait_for_timeout(700)
        vis = page.evaluate("() => { const e=document.querySelector('[id$=\"status.start\"]');"
                            "return e ? getComputedStyle(e).display!=='none' : false; }")
        if not vis:
            break
    page.wait_for_timeout(500)


# Órgãos julgadores que denunciam matéria FAZENDÁRIA/tributária (sinal grátis
# na lista — complementa a classe, que às vezes é genérica "Procedimento Comum").
ORGAO_FAZENDA = ["FAZENDA", "EXECUCOES FISCAIS", "EXECUCAO FISCAL", "FAZENDARIA", "TRIBUTAR"]


def _col(cells, i):
    return cells[i] if i < len(cells) else ""


def _empresa_polo(razao, ativo, passivo):
    r = _norm(razao)
    # casa por prefixo do nome (razão social costuma vir com sufixo LTDA/EPP)
    chave = " ".join([t for t in r.split() if len(t) > 2][:4])
    if chave and chave in _norm(ativo):
        return "ativo"
    if chave and chave in _norm(passivo):
        return "passivo"
    return "?"


def analisar(todos, catalogo, catalogo_norm, razao, cnpj_fmt):
    """Classifica pela LISTA (classe cell[5], órgão cell[3], polos cell[6]/[7]) —
    sem abrir autos. O assunto exato não vem na lista; a classe+órgão+polo já
    separam tributário de diverso e a empresa-autora (tese dela) da ré."""
    tese_hits = {}          # tese -> [procs]  (best-effort pela classe/órgão)
    trib_ativo, trib_passivo, descartados = [], [], []
    for proc, r in todos.items():
        cells = r["cells"]
        classe = _col(cells, 5)
        orgao = _col(cells, 3)
        ativo = _col(cells, 6)
        passivo = _col(cells, 7)
        situacao = _col(cells, 8)
        grau = r["grau"]
        polo = _empresa_polo(razao, ativo, passivo)
        fazenda = any(k in _norm(orgao) for k in ORGAO_FAZENDA)

        # 1) classe claramente incompatível → fora
        cn = _norm(classe)
        if any(k in cn for k in CLASSES_FORA):
            descartados.append((proc, classe, orgao, polo, "classe incompatível"))
            continue
        # 2) é tributário? O sinal CONFIÁVEL é o ÓRGÃO fazendário — a classe é
        #    genérica demais (validado nos dados reais: "Embargos à Execução" e
        #    "Cumprimento de Sentença" em Vara CÍVEL são dívida civil, não tese).
        #    Exceção: classe que já NOMEIA o tributário ("Execução Fiscal") vale
        #    mesmo em Vara Única de comarca pequena (sem vara fazendária própria).
        unambiguo = "EXECUCAO FISCAL" in cn
        eh_trib = fazenda or unambiguo
        if not eh_trib:
            descartados.append((proc, classe, orgao, polo, "assunto diverso / cível"))
            continue
        item = {"proc": proc, "grau": grau, "classe": classe, "orgao": orgao,
                "polo": polo, "situacao": situacao}
        if polo == "ativo":
            trib_ativo.append(item)   # empresa AUTORA = tese dela
            tese, conf = classificar_tese(classe + " " + orgao, classe, catalogo_norm)
            if tese:
                tese_hits.setdefault(tese, []).append((proc, conf, grau))
        else:
            trib_passivo.append(item) # ré (ex: executada pela Fazenda) — relevante, não é tese dela

    print("\n" + "=" * 74)
    print(f"ANÁLISE DE TESES — {razao} ({cnpj_fmt})")
    print("=" * 74)
    print(f"Processos únicos (1g+2g): {len(todos)}  |  tributários da empresa como AUTORA: "
          f"{len(trib_ativo)}  |  como ré: {len(trib_passivo)}  |  descartados (diversos): {len(descartados)}")

    print(f"\n>>> PROCESSOS TRIBUTÁRIOS EM QUE A EMPRESA É AUTORA (teses dela) — {len(trib_ativo)}:")
    if not trib_ativo:
        print("    (nenhum — a empresa não figura como autora em processo tributário no TJRN)")
    for it in trib_ativo:
        print(f"    {it['proc']} [{it['grau']}] {it['classe']} | {it['orgao']} | {it['situacao']}")

    print(f"\n>>> TESES DO CATÁLOGO IDENTIFICADAS (best-effort pela classe/órgão) — {len(tese_hits)}:")
    if not tese_hits:
        print("    (nenhuma casada só pela classe — o assunto exato exige abrir os autos;")
        print("     os processos-autora acima são os candidatos a mapear pra tese)")
    for tese, procs in tese_hits.items():
        print(f"    ✓ {tese}")
        for pr, conf, grau in procs:
            print(f"        {pr} [{grau}] (confiança {conf})")

    gap = [n for n in catalogo if n not in tese_hits]
    print(f"\n>>> TESES A OFERECER (gap — {len(gap)} de {len(catalogo)}):")
    for n in gap:
        print(f"    ○ {n}")

    if trib_passivo:
        print(f"\n>>> (contexto) EMPRESA COMO RÉ em processo tributário — {len(trib_passivo)} "
              "(ex: executada pela Fazenda — NÃO é tese dela):")
        for it in trib_passivo:
            print(f"    {it['proc']} [{it['grau']}] {it['classe']} | {it['orgao']}")


if __name__ == "__main__":
    main()
