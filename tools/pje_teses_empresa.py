# -*- coding: utf-8 -*-
"""
pje_teses_empresa.py — dado o CNPJ de uma empresa, descobre no PJe-TJRN (1º e 2º
grau) QUAIS TESES TRIBUTÁRIAS ela já ajuizou, pra saber quais o escritório ainda
pode oferecer (gap = catálogo de teses − teses já ajuizadas).

COMO: (1) PJe (com A3) busca por CNPJ e traz número/classe/órgão/polos na LISTA
— filtramos aí (autora + classe de tese + vara fazendária), sem abrir autos.
(2) Pra CRAVAR A TESE, o assunto CNJ vem do **DataJud** (API pública do CNJ, sem
A3 nem limite, 1º e 2º grau) — o visualizador de autos do PJe NÃO mostra o
assunto. 1º e 2º grau compartilham o número CNJ unificado → dedup por número.

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

# Graus a buscar. ESTADUAL (TJRN) = ICMS/ISS/IPTU. FEDERAL (TRF5, seção RN) =
# PIS/COFINS/IRPJ/CSLL/IRRF — a MAIORIA das teses tributárias tramita aqui, então
# sem o federal o sistema perdia a maior parte das teses. Mesmo caminho Seam,
# hosts diferentes. 2g = recursos/apelações. rótulo curto vira nome do "grau".
GRAUS = {
    "1g":  "https://pje1g.tjrn.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
    "2g":  "https://pje2g.tjrn.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
    "1gf": "https://pje1g.trf5.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
    "2gf": "https://pje2g.trf5.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
}
RE_PROC = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
TESE_ID = {}  # norm(nome da tese) -> acao_id; preenchido em main()


# ---------------------------------------------------------------------------
# Supabase REST (o CLI anda instável nesta máquina; REST é confiável)
# ---------------------------------------------------------------------------
def sb(path):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


# DataJud (API pública do CNJ) — fonte OFICIAL do assunto/classe CNJ por número
# de processo, de qualquer grau, sem A3 e sem limite. Chave pública do wiki do
# CNJ (pode rotacionar — override por env DATAJUD_API_KEY). É o que crava a TESE.
DATAJUD_KEY = os.environ.get(
    "DATAJUD_API_KEY", "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==")
# sigla do tribunal pelo número CNJ (....J.TR....). J=8 estadual: TR->sigla.
_TR_ESTADUAL = {"20": "tjrn", "15": "tjpb", "17": "tjpe", "06": "tjce",
                "26": "tjsp", "19": "tjrj", "13": "tjmg"}
def _datajud_endpoint(numero):
    m = re.search(r"\.(\d)\.(\d{2})\.", numero)
    if not m:
        return "api_publica_tjrn"
    j, tr = m.group(1), m.group(2)
    if j == "8":
        return f"api_publica_{_TR_ESTADUAL.get(tr, 'tjrn')}"
    if j == "4":  # Justiça Federal → TRF por região (TR = 01..06)
        return f"api_publica_trf{int(tr)}"
    return "api_publica_tjrn"


def datajud_meta(numero):
    """Retorna (classe, [assuntos], grau, orgao) do DataJud, ou (None, [], ...)."""
    nd = re.sub(r"\D", "", numero)
    body = json.dumps({"query": {"match": {"numeroProcesso": nd}}}).encode()
    req = urllib.request.Request(
        f"https://api-publica.datajud.cnj.jus.br/{_datajud_endpoint(numero)}/_search",
        data=body, method="POST",
        headers={"Authorization": f"APIKey {DATAJUD_KEY}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return None, [], None, f"erro DataJud: {e}"
    hits = d.get("hits", {}).get("hits", [])
    if not hits:
        return None, [], None, None
    s = hits[0]["_source"]
    classe = (s.get("classe") or {}).get("nome")
    assuntos = [a.get("nome") for a in (s.get("assuntos") or []) if a.get("nome")]
    grau = s.get("grau")
    orgao = (s.get("orgaoJulgador") or {}).get("nome")
    return classe, assuntos, grau, orgao


def sb_upsert(path, body, on_conflict):
    """POST com upsert (merge) — usado pra gravar os processos detectados."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}?on_conflict={on_conflict}",
        data=data, method="POST",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.status


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
# Classes de TESE COMERCIAL (empresa ATACA proativamente o tributo — é o que o
# escritório vende). SÓ essas interessam. Embargos/execução/cumprimento (defesa
# ou cobrança) NÃO têm valor comercial → descartados (decisão do usuário).
CLASSES_TESE = [
    "MANDADO DE SEGURANCA", "PROCEDIMENTO COMUM", "ACAO ORDINARIA",
    "ACAO DECLARATORIA", "DECLARATORIA", "ANULATORIA", "REPETICAO DE INDEBITO",
    "ACAO DE REPETICAO", "CONSIGNACAO EM PAGAMENTO", "TUTELA ANTECIPADA ANTECEDENTE",
]
# Classes SEM valor comercial — defesa/cobrança/execução. Descartadas mesmo em
# vara fazendária (não é uma tese que a gente ajuíza pra vender).
CLASSES_SEM_VALOR = [
    "EMBARGOS", "EXECUCAO FISCAL", "EXECUCAO DE TITULO", "EXECUCAO CONTRA",
    "CUMPRIMENTO DE SENTENCA", "CUMPRIMENTO PROVISORIO", "MONITORIA",
    "BUSCA E APREENSAO", "EXECUCAO DE TITULO EXTRAJUDICIAL",
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

# Mapa ASSUNTO(CNJ do DataJud) -> tese do catálogo. Ordem IMPORTA: primeira regra
# que casa vence, então as ESPECÍFICAS vêm antes das genéricas (senão um "Cofins"
# bare cairia na tese de PIS/COFINS-base antes de checar creditamento etc.).
# Só valem regras cuja tese está no catálogo do escritório (checado em runtime).
# Vocabulário calibrado nas teses reais: crédito presumido ICMS, terço de férias,
# equiparação clínica/hospital, PIS/COFINS na própria base, RAT, IRRF, etc.
def regras_tese():
    # As keywords casam contra ASSUNTO(DataJud) + CLASSE + TEXTO DA PETIÇÃO. Como
    # o assunto CNJ engana (ex: PERSE tagado "Crédito Presumido"), o objeto real
    # vem da petição. Ordem = específica -> genérica (primeira que casa vence).
    return [
        # PERSE — setor de eventos (assunto CNJ costuma NÃO citar; só a petição)
        ("MANUTENÇÃO NO PERSE (PROGRAMA EMERGENCIAL DE RETOMADA DO SETOR DE EVENTOS)",
         {"any": ["PERSE", "PROGRAMA EMERGENCIAL DE RETOMADA", "SETOR DE EVENTOS"], "conf": "alta"}),
        ("RESCISÓRIA DO TEMA 985 (TERÇO DE FÉRIAS)",
         {"any": ["TERCO CONSTITUCIONAL", "TERCO DE FERIAS", "ADICIONAL DE FERIAS",
                  "1/3 DE FERIAS", "TEMA 985"], "conf": "alta"}),
        ("REDUÇÃO ALÍQUOTA RAT BASEADO NA ATIVIDADE PREPONDERANTE",
         {"any": ["RAT", "FAP", "GILRAT", "SAT", "RISCOS AMBIENTAIS DO TRABALHO",
                  "ATIVIDADE PREPONDERANTE"], "conf": "alta"}),
        ("RECUPERAÇÃO IRRF E FOLHA PARA MUNICÍPIOS",
         {"any": ["IRRF", "IMPOSTO DE RENDA RETIDO", "RETIDO NA FONTE"], "conf": "alta"}),
        ("EQUIPARAÇÃO DE CLÍNICAS A HOSPITAIS (IRPJ/CSLL)",
         {"any": ["SERVICO HOSPITALAR", "SERVICOS HOSPITALARES", "HOSPITALAR",
                  "EQUIPARACAO A HOSPITAL", "SERVICOS DE SAUDE"],
          "hint": ["IRPJ", "CSLL", "LUCRO PRESUMIDO"], "conf": "alta"}),
        # crédito presumido de ICMS FORA da base do PIS/COFINS (incentivo fiscal) —
        # tese do processo 0023290-14.2025. Vem ANTES da de IRPJ/CSLL.
        ("NÃO TRIBUTAÇÃO DOS INCENTIVOS FISCAIS DE ICMS PELO IRPJ, CSLL, PIS E COFINS",
         {"all": ["CREDITO PRESUMIDO"], "any": ["PIS", "COFINS"], "conf": "alta"}),
        ("NÃO TRIBUTAÇÃO DOS INCENTIVOS FISCAIS DE ICMS PELO IRPJ, CSLL, PIS E COFINS",
         {"any": ["INCENTIVO FISCAL", "SUBVENCAO", "SUBVENCOES", "BENEFICIO FISCAL"],
          "hint": ["ICMS"], "conf": "alta"}),
        # crédito presumido de ICMS fora da base do IRPJ/CSLL (sem PIS/COFISN acima)
        ("EXCLUSÃO DA INCIDÊNCIA DO IRPJ E DA CSLL SOBRE OS CRÉDITOS PRESUMIDOS DE ICMS",
         {"all": ["CREDITO PRESUMIDO"], "conf": "alta"}),
        # creditamento PIS/COFINS sobre ICMS na aquisição (exige AQUISICAO p/ não
        # colidir com crédito presumido)
        ("CREDITAMENTO DE PIS E COFINS SOBRE O ICMS NA AQUISIÇÃO DE MERCADORIAS",
         {"all": ["AQUISICAO"], "any": ["PIS", "COFINS"], "hint": ["ICMS", "CREDIT"], "conf": "alta"}),
        ("MAJORAÇÃO DE 10% SOBRE O LUCRO PRESUMIDO",
         {"any": ["ADICIONAL DE 10", "MAJORACAO"], "hint": ["LUCRO PRESUMIDO", "IRPJ"], "conf": "media"}),
        # GENÉRICA por último: PIS/COFINS na PRÓPRIA base
        ("EXCLUSÃO DO PIS E DA COFINS DA SUA BASE DE CÁLCULO",
         {"all": ["BASE DE CALCULO"], "any": ["PIS", "COFINS"], "conf": "media"}),
    ]


def _norm(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").upper())
                   if unicodedata.category(c) != "Mn")


def assunto_tributario(assunto):
    a = _norm(assunto)
    return any(k in a for k in ASSUNTO_TRIB)


def classificar_tese(assunto, classe, catalogo_norm, peticao=""):
    """Retorna (nome_tese_do_catalogo | None, confianca). Casa contra assunto CNJ
    + classe + TEXTO DA PETIÇÃO (o objeto real; o assunto CNJ engana)."""
    texto = _norm(assunto) + " " + _norm(classe) + " " + _norm(peticao)
    for nome, rg in regras_tese():
        if _norm(nome) not in catalogo_norm:
            continue  # tese não está no catálogo do escritório
        if "all" in rg and not all(t in texto for t in rg["all"]):
            continue
        if "any" in rg and not any(t in texto for t in rg["any"]):
            continue
        # confiança base da regra; hint presente sobe "media" -> "alta"
        conf = rg.get("conf", "media")
        if conf == "media" and any(t in texto for t in rg.get("hint", [])):
            conf = "alta"
        return nome, conf
    return None, None


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cnpj", help="CNPJ único a analisar")
    ap.add_argument("--cnpjs", help="lista de CNPJs separados por vírgula (1 login, N empresas)")
    ap.add_argument("--acao", metavar="ACAO_ID", help="analisa TODAS as empresas de uma ação (via elegibilidade)")
    ap.add_argument("--limit", type=int, default=200, help="máx de empresas no modo --acao")
    ap.add_argument("--autos", action="store_true",
                    help="abre os autos dos candidatos p/ ler o assunto CNJ e cravar a tese exata "
                         "(gasta abertura de autos — sujeito ao limite diário do TJRN)")
    ap.add_argument("--gravar", action="store_true",
                    help="persiste os candidatos em empresa_processos_tributarios (visível no CRM)")
    ap.add_argument("--inspect", action="store_true",
                    help="1ª vez: loga, dumpa os campos do form + linhas cruas de resultado e sai")
    ap.add_argument("--graus", default="1g,2g,1gf,2gf",
                    help="graus a buscar: 1g/2g=TJRN estadual, 1gf/2gf=TRF5 federal (default todos)")
    args = ap.parse_args()
    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("ERRO: rode `. tools\\pje-env.local.ps1` antes.")

    # ---- monta a lista de CNPJs alvo (single / lista / ação) ----
    alvos = []  # [cnpj_digits]
    if args.acao:
        rows = sb(f"elegibilidade?select=empresas!inner(cnpj)&acao_id=eq.{args.acao}&limit={args.limit}")
        for r in rows:
            c = re.sub(r"\D", "", ((r.get("empresas") or {}).get("cnpj") or ""))
            if len(c) == 14: alvos.append(c)
    elif args.cnpjs:
        alvos = [re.sub(r"\D", "", c) for c in args.cnpjs.split(",")]
    elif args.cnpj:
        alvos = [re.sub(r"\D", "", args.cnpj)]
    alvos = [c for c in dict.fromkeys(alvos) if len(c) == 14]  # dedup + válidos
    if not alvos:
        sys.exit("Nada a analisar. Passe --cnpj, --cnpjs ou --acao.")

    cat_rows = sb("acoes_tributarias?select=id,nome&status=eq.Ativa")
    catalogo = [r["nome"] for r in cat_rows]
    catalogo_norm = {_norm(n): n for n in catalogo}          # norm(nome) -> nome (tese no catálogo)
    global TESE_ID
    TESE_ID = {_norm(r["nome"]): r["id"] for r in cat_rows}  # norm(nome) -> acao_id (p/ gravar)
    print(f"{len(alvos)} empresa(s) a analisar | catálogo: {len(catalogo)} teses")

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

        # LOGIN UMA VEZ (na 1ª busca); depois roda todos os CNPJs na mesma sessão.
        page = _login_once(ctx, page, GRAUS[graus[0]])
        if page is None:
            print("Timeout aguardando login."); return

        for i, cnpj_digits in enumerate(alvos, 1):
            print(f"\n———— [{i}/{len(alvos)}] ————", flush=True)
            _processar_cnpj(page, ctx, cnpj_digits, graus, catalogo, catalogo_norm,
                            args.inspect, args.autos, args.gravar)
            if args.inspect:
                print("\n[INSPECT] fim (só a 1ª empresa). Rode sem --inspect.")
                break


SEL_FORM = ("input[id$=':documentoParte'], input[id*='documentoParte'], "
            "input[id$=':nomeParte'], input[id*='nomeParte']")
LOGIN_MARKERS = ("sso", "/login", "login.seam", "auth", "openid", "saml",
                 "keycloak", "acesso.gov", "certificado")


def _login_once(ctx, page, url):
    """Abre a consulta 1g e espera o A3. NÃO re-navega a tela de login (recarregar
    por baixo impede o certificado). Retorna a page logada ou None (timeout)."""
    try: page.goto(url, wait_until="domcontentloaded")
    except Exception: pass
    print(">>> Faça LOGIN no TJRN com o A3 na janela do Chrome. Aguardando...", flush=True)
    for _ in range(300):  # ~10 min
        for pg in list(ctx.pages):
            try:
                if pg.query_selector(SEL_FORM):
                    print(">>> Autenticado.", flush=True)
                    return pg
            except Exception:
                pass
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
    return None


def _garantir_form(page, ctx, url, grau):
    """Garante o form de consulta do grau. O FEDERAL (TRF5) é outra instância PJe
    e pode exigir login A3 próprio — não re-navega a tela de login (recarregar
    impede o A3), só navega uma vez e aguarda o form em qualquer aba. Retorna a
    page com o form (pode ser outra aba) ou None (login não concluído a tempo)."""
    try:
        page.goto(url, wait_until="domcontentloaded")
    except Exception:
        pass
    avisou = False
    for i in range(150):  # ~2.5min máx; retorna assim que o form aparece
        for pg in list(ctx.pages):
            try:
                if pg.query_selector(SEL_FORM):
                    return pg
            except Exception:
                pass
        if i == 6 and not avisou:  # ~6s sem form => provável login desta instância
            print(f">>> [{grau}] Se pedir, faça LOGIN A3 nesta instância (Chrome). Aguardando...", flush=True)
            avisou = True
        page.wait_for_timeout(1000)
    return None


def _processar_cnpj(page, ctx, cnpj_digits, graus, catalogo, catalogo_norm, inspect, autos=False, gravar=False):
    cnpj_fmt = f"{cnpj_digits[0:2]}.{cnpj_digits[2:5]}.{cnpj_digits[5:8]}/{cnpj_digits[8:12]}-{cnpj_digits[12:14]}"
    emp = sb(f"empresas?select=id,nome,razao_social&or=(cnpj.eq.{urllib.parse.quote(cnpj_fmt)},cnpj.eq.{cnpj_digits})")
    empresa = emp[0] if emp else None
    empresa_id = (empresa or {}).get("id")
    razao = (empresa or {}).get("razao_social") or (empresa or {}).get("nome") or ""
    print(f"CNPJ {cnpj_fmt} | {razao or '(não está no CRM)'}", flush=True)

    todos = {}
    for grau in graus:
        url = GRAUS[grau]
        pg = _garantir_form(page, ctx, url, grau)
        if pg is None:
            print(f"[{grau}] form indisponível (login não concluído nesta instância) — pulando este grau.")
            continue
        page = pg  # usa a aba onde o form apareceu (login federal pode abrir outra)
        if inspect:
            campos = page.evaluate(r"""() => [...document.querySelectorAll('input,select')]
                .map(e => ({id:e.id, name:e.name, type:e.type})).filter(e => e.id||e.name)""")
            print(f"=== [{grau}] CAMPOS ({len(campos)}) ==="); [print("  ", c) for c in campos[:40]]
        achou = _buscar(page, cnpj_digits, razao)
        page.wait_for_timeout(700)
        linhas = page.evaluate(r"""() => {
          const out=[];
          for (const tr of document.querySelectorAll('table tr')) {
            const m = tr.innerText.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
            if (!m) continue;
            const cells = [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g,' ').trim());
            out.push({proc:m[0], cells});
          }
          return out;
        }""")
        print(f"[{grau}] busca por {'CNPJ' if achou=='doc' else 'razão social'}: {len(linhas)} linha(s)")
        if inspect and linhas:
            for r in linhas[:5]:
                print(f"  proc={r['proc']}")
                for idx, c in enumerate(r["cells"]):
                    if c: print(f"     cell[{idx}]: {c[:120]}")
        for r in linhas:
            if r["proc"] in todos:
                continue
            # abre a PETIÇÃO dos candidatos AGORA (página está nos resultados deste
            # grau — evita re-navegar). É o objeto real da tese.
            if not inspect and _eh_candidato(r["cells"], razao):
                r["peticao"] = _abrir_peticao(page, r["proc"])
                _fechar_abas_extras(page)
            todos[r["proc"]] = {**r, "grau": grau}
    if inspect:
        return

    candidatos, motivos = filtrar_teses(todos, razao)
    # Crava a TESE pelo OBJETO DA PETIÇÃO (fonte da verdade — o assunto CNJ do
    # DataJud engana: PERSE vem tagado "Crédito Presumido", etc.). DataJud entra
    # como sinal complementar (classe + assunto). Petição não lida -> só assunto.
    for c in candidatos:
        classe_dj, assuntos, _grau_dj, _org = datajud_meta(c["proc"])
        c["assunto"] = "; ".join(assuntos) if assuntos else ""
        tese, conf = classificar_tese(c["assunto"], classe_dj or c.get("classe") or "",
                                      catalogo_norm, c.get("peticao", ""))
        c["tese"], c["conf"] = tese, conf
        c["fonte_tese"] = "petição" if c.get("peticao") else "assunto(DataJud)"
    analisar(candidatos, motivos, catalogo, razao, cnpj_fmt, len(todos), True)

    # persiste no CRM SÓ o que é de fato tributário (tese cravada OU assunto
    # tributário) — candidato cujo assunto CNJ não é tributário (ex: "Abuso de
    # Poder") não entra na tabela de processos TRIBUTÁRIOS.
    persistir = [c for c in candidatos
                 if c.get("tese") or assunto_tributario(c.get("assunto") or "")]
    if gravar and candidatos:
        if not empresa_id:
            print("  [gravar] empresa não está no CRM (sem empresa_id) — nada gravado.")
        elif not persistir:
            print("  [gravar] nenhum processo tributário (os candidatos não são teses "
                  "pelo assunto CNJ) — nada gravado.")
        else:
            body = [{
                "empresa_id": empresa_id, "numero": c["proc"], "grau": c["grau"],
                "classe": c.get("classe"), "orgao": c.get("orgao"),
                "situacao": c.get("situacao"), "polo": "ativo",
                "assunto": c.get("assunto") or None,
                "acao_id": TESE_ID.get(_norm(c["tese"])) if c.get("tese") else None,
                "fonte": "pje_tjrn+datajud",
            } for c in persistir]
            try:
                sb_upsert("empresa_processos_tributarios", body, "empresa_id,numero")
                print(f"  [gravar] {len(body)} processo(s) tributário(s) gravado(s) no CRM.")
            except Exception as e:
                print(f"  [gravar] falha: {e}")


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


def _eh_candidato(cells, razao):
    """True se a linha é candidata a tese: empresa AUTORA + classe de tese +
    não é embargos/execução/cumprimento. (mesma regra do filtrar_teses, por linha)"""
    cn = _norm(_col(cells, 5))
    if _empresa_polo(razao, _col(cells, 6), _col(cells, 7)) != "ativo":
        return False
    if any(k in cn for k in CLASSES_SEM_VALOR):
        return False
    return any(k in cn for k in CLASSES_TESE)


def _fechar_abas_extras(page):
    """Fecha abas órfãs de autos, deixa só a consulta (evita acúmulo que trava)."""
    try:
        for pg in list(page.context.pages):
            if pg is not page:
                try: pg.close()
                except Exception: pass
    except Exception:
        pass


def _abrir_peticao(page, proc):
    """Abre os autos (nova aba) -> 1º documento (petição inicial) -> extrai o TEXTO
    do PDF.js. É a FONTE do objeto real da tese (o assunto CNJ engana). Retorna ''
    se os autos não abrirem (limite diário do TJRN/TRF5) — aí cai no assunto."""
    ctx = page.context
    try:
        with ctx.expect_page(timeout=20000) as pinfo:
            page.evaluate("""(proc)=>{
              const tr=[...document.querySelectorAll('table tr')].find(t=>t.innerText.includes(proc));
              const a=tr&&[...tr.querySelectorAll('a')].find(x=>x.textContent.includes(proc));
              if(a) a.click();
            }""", proc)
        autos = pinfo.value
    except Exception:
        return ""
    txt = ""
    try:
        autos.wait_for_load_state("domcontentloaded")
        autos.wait_for_timeout(2500)
        try:
            autos.click("a[title='Primeiro documento'], [aria-label='Primeiro documento']", timeout=8000)
        except Exception:
            pass
        autos.wait_for_timeout(2000)
        for k in range(16):
            txt = autos.evaluate(r"""() => {
              const ifr=[...document.querySelectorAll('iframe')].find(f=>/pdfjs|viewer\.html/.test(f.src||''));
              if(!ifr) return '';
              try { const d=ifr.contentDocument; if(!d) return '';
                let t=''; d.querySelectorAll('.textLayer').forEach(l=>t+=l.innerText+'\n');
                return t || (d.body?d.body.innerText:''); } catch(e){ return ''; }
            }""") or ""
            if len(txt) > 800: break
            if k >= 7 and len(txt) < 300: break
            autos.wait_for_timeout(900)
    except Exception:
        pass
    try: autos.close()
    except Exception: pass
    return txt


def filtrar_teses(todos, razao):
    """Candidatos a TESE COMERCIAL pela LISTA: empresa AUTORA + classe de tese
    (MS/Procedimento Comum/Declaratória/…), descartando ré e embargos/execução/
    cumprimento. NÃO filtra por 'vara fazendária' — isso só existe no estadual;
    no FEDERAL o órgão é 'Vara Federal' genérica. O sinal de TRIBUTÁRIO é o
    ASSUNTO do DataJud (aplicado depois), não o órgão. Retorna (candidatos, contagem)."""
    candidatos, motivos = [], {"re": 0, "sem_valor": 0, "nao_tese": 0}
    for proc, r in todos.items():
        cells = r["cells"]
        classe, orgao = _col(cells, 5), _col(cells, 3)
        polo = _empresa_polo(razao, _col(cells, 6), _col(cells, 7))
        cn = _norm(classe)
        if polo != "ativo":                          # ré = sem valor
            motivos["re"] += 1; continue
        if any(k in cn for k in CLASSES_SEM_VALOR):   # embargos/execução/cumprimento
            motivos["sem_valor"] += 1; continue
        if not any(k in cn for k in CLASSES_TESE):    # classe não é de tese
            motivos["nao_tese"] += 1; continue
        candidatos.append({"proc": proc, "grau": r["grau"], "classe": classe,
                           "orgao": orgao, "situacao": _col(cells, 8),
                           "peticao": r.get("peticao", "")})
    return candidatos, motivos


def _ler_assunto(page, proc):
    """Abre a aba dos autos do processo e lê o ASSUNTO no cabeçalho (HTML) —
    NÃO abre documento/PDF (o assunto está na capa). Retorna (assunto, dump_cru).
    Se os autos não abrirem (limite diário do TJRN), retorna (None, motivo)."""
    ctx = page.context
    try:
        with ctx.expect_page(timeout=20000) as pinfo:
            page.evaluate("""(proc)=>{
              const tr=[...document.querySelectorAll('table tr')].find(t=>t.innerText.includes(proc));
              const a=tr&&[...tr.querySelectorAll('a')].find(x=>x.textContent.includes(proc));
              if(a) a.click();
            }""", proc)
        autos = pinfo.value
    except Exception:
        return None, "autos não abriram (limite diário do TJRN?)"
    # O painel "Detalhes/Informações do processo" (com o ASSUNTO) carrega async
    # e às vezes num frame. Poll ~18s por texto que contenha "Assunto", varrendo
    # a página E todos os frames; tenta abrir um toggle de detalhes se existir.
    try:
        autos.wait_for_load_state("domcontentloaded")
    except Exception:
        pass
    txt = ""
    for k in range(18):
        autos.wait_for_timeout(1000)
        try:
            if k == 2:  # tenta revelar o painel de dados do processo
                autos.evaluate("""() => {
                  const el=[...document.querySelectorAll('a,button,span,div')]
                    .find(e=>/informaç|detalhe|dados do processo|capa/i.test(e.textContent||''));
                  if(el) el.click();
                }""")
            partes = [autos.evaluate("() => document.body ? document.body.innerText : ''") or ""]
            for fr in autos.frames:
                try: partes.append(fr.evaluate("() => document.body ? document.body.innerText : ''") or "")
                except Exception: pass
            txt = "\n".join(partes)
        except Exception:
            txt = txt or ""
        if re.search(r"assunto", txt, re.I) and len(txt) > 400:
            break
    try: autos.close()
    except Exception: pass
    m = re.search(r"Assunto[s]?\b\s*[:\-]?\s*(.+)", txt, re.I)
    assunto = ""
    if m:
        assunto = re.split(r"\n|Classe|Órg[ãa]o|Distribuiç|Autuaç|Valor da|Pol[oô]",
                           m.group(1), 1)[0].strip()[:200]
    return assunto, txt[:2000]


def analisar(candidatos, motivos, catalogo, razao, cnpj_fmt, total, autos):
    print("\n" + "=" * 74)
    print(f"ANÁLISE DE TESES — {razao} ({cnpj_fmt})")
    print("=" * 74)
    print(f"Processos (TJRN+TRF5, 1º/2º): {total}  →  CANDIDATOS (autora, classe de tese): {len(candidatos)}")
    print(f"  descartados na lista: {motivos['re']} ré · {motivos['sem_valor']} embargos/execução/cumprimento "
          f"· {motivos['nao_tese']} classe diversa  (o tributário é decidido pelo assunto do DataJud abaixo)")

    teses_ja = {}   # tese do catálogo -> [procs]
    print(f"\n>>> CANDIDATOS (empresa autora em classe de tese) — {len(candidatos)}:")
    if not candidatos:
        print("    (nenhum — a empresa não ajuizou tese tributária proativa no TJRN)")
    for it in candidatos:
        linha = f"    {it['proc']} [{it['grau']}] {it['classe']} | {it['orgao']} | {it['situacao']}"
        asn = it.get("assunto") or ""
        tese = it.get("tese")
        pet = "petição lida" if it.get("peticao") else "petição NÃO lida (autos bloqueados?)"
        linha += f"\n        assunto (DataJud): {asn or '(sem assunto)'}  |  {pet}"
        if tese:
            linha += (f"\n        => TESE: {tese.strip()} (confiança {it.get('conf')}"
                      f", fonte: {it.get('fonte_tese','?')})")
            teses_ja.setdefault(tese, []).append(it["proc"])
        elif asn and assunto_tributario(asn):
            linha += "\n        => tributário, mas fora do catálogo de teses (revisar manualmente)"
        elif asn:
            linha += "\n        => NÃO é matéria tributária (não é tese)"
        print(linha)

    ja = list(teses_ja.keys())
    if ja:
        print(f"\n>>> TESES QUE A EMPRESA JÁ AJUIZOU ({len(ja)}):")
        for t in ja:
            print(f"    ✓ {t.strip()}  ({', '.join(teses_ja[t])})")
    elif candidatos:
        print("\n>>> NENHUMA tese do catálogo foi ajuizada por esta empresa "
              "(os processos-candidatos não são teses nossas pelo assunto CNJ).")
    gap = [n for n in catalogo if n not in teses_ja]
    print(f"\n>>> TESES A OFERECER (gap — {len(gap)} de {len(catalogo)}):")
    for n in gap:
        print(f"    ○ {n.strip()}")


if __name__ == "__main__":
    main()
