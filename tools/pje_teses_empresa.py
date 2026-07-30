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
# PJe 1.x do TRF5: instância PRÓPRIA por Seção Judiciária (uma por estado). Os
# processos antigos ficaram lá — o 2.x (pje1g/pje2g.trf5) não os mostra. Qual
# instância consultar depende da UF DA EMPRESA. Grau "1x" resolve em runtime.
# ATENÇÃO: usar SEMPRE a consulta de TERCEIROS. A "ConsultaProcesso/listView"
# só devolve processos em que o ADVOGADO LOGADO atua — com ela a varredura
# retornava só os casos do próprio escritório e dava "0 processos" para empresas
# que litigam bastante (ex.: Dois A Engenharia: 1 em vez de 6).
PJE_1X = {
    "RN": "https://pje.jfrn.jus.br/pje/Processo/ConsultaProcessoTerceiros/listView.seam",
    "PB": "https://pje.jfpb.jus.br/pje/Processo/ConsultaProcessoTerceiros/listView.seam",
    "PE": "https://pje.jfpe.jus.br/pje/Processo/ConsultaProcessoTerceiros/listView.seam",
    "AL": "https://pje.jfal.jus.br/pje/Processo/ConsultaProcessoTerceiros/listView.seam",
    "SE": "https://pje.jfse.jus.br/pje/Processo/ConsultaProcessoTerceiros/listView.seam",
    "CE": "https://pje.jfce.jus.br/pje/Processo/ConsultaProcessoTerceiros/listView.seam",
}
# TRF5 2º grau (1.x) — usar a Consulta de TERCEIROS (a ConsultaProcesso do advogado
# só devolve processos do advogado LOGADO). Aqui vivem os processos do 1º grau
# REMETIDOS ao TRF5 (recurso/remessa necessária): o JFRN 1.x mostra os metadados mas
# BLOQUEIA os documentos ("Processo remetido ao TRF5 ... utilize o sistema do TRF5"),
# então a petição/acórdão só é lida por aqui. Instância própria -> login A3 próprio.
PJE_1X_2G = "https://pje.trf5.jus.br/pje/Processo/ConsultaProcessoTerceiros/listView.seam"
# PROTOCOLO PADRÃO de análise de teses (o que roda quando a UI pede): as teses
# tributárias federais são de 1º GRAU e vivem em DOIS sistemas — o 2.x (pje1g.trf5)
# e o 1.x da Seção Judiciária (pje.jfrn etc.), onde ficaram os processos ANTIGOS que
# o 2.x não mostra. NÃO se busca o 2º grau (pje2g.trf5 = recursos): a tese não nasce
# lá. Por isso 1gf (2.x, 1º grau) + 1x (1.x, 1º grau) — sem 2gf.
PROTOCOLO_PADRAO = "1gf,1x"
RE_PROC = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")

# QUALIDADE (23/07): estas teses têm assunto CNJ GENÉRICO (previdenciário) que o
# DataJud sobre-classifica — auditoria mostrou 60-73% delas cravadas SÓ pelo
# assunto, sem ler a inicial. Para estas, exige-se a PETIÇÃO INICIAL válida para
# CRAVAR (acao_id); sem ela vira sugestão (amarelo), não "ajuizada" (verde).
TESES_SO_COM_PETICAO_RAW = (
    "LIMITAÇÃO A 20 SALÁRIOS MÍNIMOS DA BASE DAS CONTRIBUIÇÕES DE TERCEIROS",
    "NÃO INCIDÊNCIA DA CONTRIBUIÇÃO PATRONAL (CPP) SOBRE VERBAS INDENIZATÓRIAS",
)
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


def datajud_lote(numeros, paralelos=5):
    """{numero: (classe, assuntos, grau, orgao)} buscando em PARALELO.

    Cada consulta é HTTP puro e independente das outras — em série, uma empresa
    com 13 candidatos pagava 13 idas e voltas enfileiradas. Concorrência modesta
    (5) porque a API é pública e não vale a pena irritar o CNJ.
    """
    if not numeros:
        return {}
    from concurrent.futures import ThreadPoolExecutor
    out = {}
    with ThreadPoolExecutor(max_workers=min(paralelos, len(numeros))) as ex:
        for n, r in zip(numeros, ex.map(datajud_meta, numeros)):
            out[n] = r
    return out


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


def sb_patch(path, body):
    """PATCH — usado pra mover o status do protocolo (fila da UI)."""
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}", data=json.dumps(body).encode(), method="PATCH",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.status


def _agora():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# TELEMETRIA — onde o tempo vai. Sem isto a otimização é chute: já perdemos 90s
# por empresa num timeout que ninguém via. Cada fase cronometrada vira uma linha
# em tools/.cache/telemetria.jsonl, lida por tools/pje_eficiencia.py.
# ---------------------------------------------------------------------------
TELEMETRIA = str(ROOT / "tools" / ".cache" / "telemetria.jsonl")


class cron:
    """Cronometra um trecho e registra. Nunca deixa a medição quebrar o scraper."""

    def __init__(self, fase, **extra):
        self.fase, self.extra = fase, extra

    def __enter__(self):
        self.t0 = time.time()
        return self

    def __exit__(self, *exc):
        seg = round(time.time() - self.t0, 2)
        try:
            os.makedirs(os.path.dirname(TELEMETRIA), exist_ok=True)
            with open(TELEMETRIA, "a", encoding="utf-8") as fh:
                fh.write(json.dumps({"ts": _agora(), "fase": self.fase, "seg": seg,
                                     "erro": bool(exc and exc[0]), **self.extra},
                                    ensure_ascii=False) + "\n")
        except Exception:
            pass
        return False


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
    # classes RECURSAIS do 2º grau (grau 2x/TRF5) — o processo de 1º grau REMETIDO
    # sobe como apelação/remessa/agravo e carrega a MESMA tese; sem elas o 2x dava
    # "classe diversa" pra tudo. (Embargos/execução seguem em CLASSES_SEM_VALOR.)
    "APELACAO", "REMESSA NECESSARIA", "REEXAME NECESSARIO", "AGRAVO DE INSTRUMENTO",
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
    # "não cumulatividade" é regime de PIS/COFINS — é tributário, e sem isto
    # processos assim eram descartados como "não é matéria tributária".
    "NAO CUMULATIVIDADE", "LANCAMENTO", "ISENCAO", "IMUNIDADE", "PRESCRICAO",
    "RAT", "SAT", "GILRAT", "FGTS", "INSS", "TERCO DE FERIAS", "TERCO CONSTITUCIONAL",
    # o CNJ usa rótulos curtos que não trazem a palavra "tributário": o PAT da P J
    # (0805286-95.2022) vinha como "Incidência sobre Lucro" e era descartado como
    # "não é matéria tributária" — sendo IRPJ/CSLL.
    "INCIDENCIA SOBRE LUCRO", "LUCRO PRESUMIDO", "LUCRO REAL", "SALARIO EDUCACAO",
    "SALARIO-EDUCACAO", "SALARIO MATERNIDADE", "SALARIO-MATERNIDADE", "INCRA",
    "SEBRAE", "SENAI", "SENAC", "SESC", "SESI", "SENAT", "APRENDIZ", "PAT",
    "ALIMENTACAO DO TRABALHADOR", "FOLHA DE SALARIOS", "GORJETA",
]
# Objetos ADMINISTRATIVOS ESPECÍFICOS — NÃO são tese (não garantem um direito
# GERAL recorrente; resolvem uma situação pontual). Ex.: MS p/ expedição de CND /
# certidão de regularidade fiscal. Mesmo que a petição toque num tributo (discute
# um débito p/ liberar a CND), o objeto é o ato administrativo, não a tese —
# então descartamos como não-tese (decisão do usuário, 20/07).
ASSUNTO_ADMINISTRATIVO = [
    "CND", "CERTIDAO NEGATIVA", "CERTIDAO POSITIVA", "CERTIDAO DE REGULARIDADE",
    "EXPEDICAO DE CERTIDAO", "EXPEDICAO DE CND", "REGULARIDADE FISCAL",
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
        # FGTS / LC 110/2001 — contribuição social do FGTS (adicional de 10% na
        # rescisão sem justa causa, art. 1º; e 0,5% mensal, art. 2º), cuja exigência
        # é questionada por já ter cumprido a finalidade (expurgos inflacionários).
        # Marcador INEQUÍVOCO é a própria lei — "LC 110" / "110/2001" casam nos 6
        # processos específicos do CRM e em 0 dos 963 não-FGTS (calibrado 28/07). O
        # assunto genérico "FGTS/Fundo de Garantia" (depósito/CND) NÃO basta: só a
        # petição/ementa que cita a LC 110 crava (política de fonte direta).
        ("INEXIGIBILIDADE DA CONTRIBUIÇÃO SOCIAL DO FGTS (LC 110/2001)",
         {"any": ["LC 110", "110/2001", "LEI COMPLEMENTAR 110", "LEI COMPLEMENTAR N 110"],
          "conf": "alta"}),
        # RESCISÓRIA só é protocolada no 2º GRAU (competência originária do
        # tribunal). Sem o gate de classe, esta regra casava "1/3 de férias" e
        # sequestrava ações de 1º grau que discutem CPP sobre verbas indenizatórias
        # — foi o caso do 0804478-71.2014 (Procedimento Comum, 4ª Vara Federal).
        ("RESCISÓRIA DO TEMA 985 (TERÇO DE FÉRIAS)",
         {"classe": ["RESCISORIA"],
          "any": ["TERCO CONSTITUCIONAL", "TERCO DE FERIAS", "ADICIONAL DE FERIAS",
                  "1/3 DE FERIAS", "TEMA 985"], "conf": "alta"}),
        # CPP sobre VERBAS INDENIZATÓRIAS vem ANTES da de 20 salários mínimos: a
        # verba (terço de férias, salário-maternidade, aviso prévio) é marcador
        # MUITO mais específico que o nome de uma contribuição. O assunto do CNJ
        # costuma trazer os dois — no 0804478-71.2014 (Ramalho) vinham "1/3 de
        # férias" + "INCRA" + "Salário-Educação", e a de 20 SM levava o processo.
        # O assunto usa hífen ("Salário-Maternidade") e o casamento é por palavra
        # inteira, então as duas grafias precisam estar aqui.
        ("NÃO INCIDÊNCIA DA CONTRIBUIÇÃO PATRONAL (CPP) SOBRE VERBAS INDENIZATÓRIAS",
         {"any": ["VERBAS INDENIZATORIAS", "VERBA INDENIZATORIA", "AVISO PREVIO INDENIZADO",
                  "PRIMEIROS 15 DIAS", "AUXILIO CRECHE", "AUXILIO-CRECHE",
                  "SALARIO MATERNIDADE", "SALARIO-MATERNIDADE",
                  "ABONO PECUNIARIO", "ABONO ASSIDUIDADE",
                  # terço de férias em 1º grau é ESTA tese, não a rescisória
                  "TERCO CONSTITUCIONAL", "TERCO DE FERIAS", "ADICIONAL DE FERIAS",
                  "1/3 DE FERIAS"], "conf": "alta"}),
        # LIMITAÇÃO A 20 SALÁRIOS MÍNIMOS das contribuições de terceiros/parafiscais
        ("LIMITAÇÃO A 20 SALÁRIOS MÍNIMOS DA BASE DAS CONTRIBUIÇÕES DE TERCEIROS",
         {"any": ["20 SALARIOS MINIMOS", "VINTE SALARIOS MINIMOS", "CONTRIBUICOES PARAFISCAIS",
                  "CONTRIBUICAO PARAFISCAL", "SALARIO EDUCACAO", "INCRA", "SEBRAE",
                  "SENAI", "SENAC", "SESC", "SESI", "SENAT", "APEX", "ABDI"], "conf": "alta"}),
        # CPP/RAT sobre VALORES RETIDOS do segurado (contribuição do empregado + IRRF)
        ("EXCLUSÃO DOS VALORES RETIDOS DO SEGURADO DA BASE DA CPP E DO RAT",
         {"any": ["VALORES RETIDOS", "VALOR RETIDO", "RETIDOS PELA", "RETIDOS A TITULO"],
          "hint": ["CONTRIBUICAO PREVIDENCIARIA", "RAT", "PATRONAL"], "conf": "alta"}),
        # RAT por ENQUADRAMENTO vem DEPOIS das teses específicas de folha: a sigla
        # RAT aparece em QUALQUER petição previdenciária ("...CPP, terceiros e
        # RAT..."), então casar por ela fazia esta regra sequestrar aprendizes e
        # valores retidos. O que distingue ESTA tese é a atividade preponderante /
        # grau de risco / FAP — não a sigla.
        # "ENQUADRAMENTO" solto era genérico demais (enquadramento no Simples/legal/
        # da atividade) e casava acórdão de PIS/COFINS como RAT (25/07). Trocado por
        # termos próprios do RAT: reenquadramento, enquadramento NO GRAU DE RISCO, GILRAT.
        ("REDUÇÃO ALÍQUOTA RAT BASEADO NA ATIVIDADE PREPONDERANTE",
         {"any": ["ATIVIDADE PREPONDERANTE", "FAP", "GRAU DE RISCO", "REENQUADRAMENTO",
                  "ENQUADRAMENTO NO GRAU", "ENQUADRAMENTO DA ATIVIDADE",
                  "RISCO LEVE", "RISCO MEDIO", "RISCO GRAVE", "ALIQUOTA DO RAT",
                  "ALIQUOTA DO SAT", "REDUCAO DO RAT", "RAT/SAT", "GILRAT"], "conf": "alta"}),
        # IRRF de MUNICÍPIOS: exige o ente público, senão casava "retido na fonte"
        # de qualquer petição e sugeria a tese para empresa privada.
        ("RECUPERAÇÃO IRRF E FOLHA PARA MUNICÍPIOS",
         {"all": ["MUNICIPIO"],
          "any": ["IRRF", "IMPOSTO DE RENDA RETIDO", "RETIDO NA FONTE"], "conf": "alta"}),
        ("EQUIPARAÇÃO DE CLÍNICAS A HOSPITAIS (IRPJ/CSLL)",
         {"any": ["SERVICO HOSPITALAR", "SERVICOS HOSPITALARES", "HOSPITALAR",
                  "EQUIPARACAO A HOSPITAL", "SERVICOS DE SAUDE"],
          "hint": ["IRPJ", "CSLL", "LUCRO PRESUMIDO"], "conf": "alta"}),
        # crédito presumido de ICMS FORA da base do PIS/COFINS (incentivo fiscal) —
        # tese do processo 0802393-63.2024. Vem ANTES da de IRPJ/CSLL. "NÃO
        # CUMULATIVIDADE" é conceito de PIS/COFINS (IRPJ/CSLL não são não-cumulativos),
        # então crédito presumido + não-cumulatividade => variante PIS/COFINS. Isso
        # desempata quando a petição (só 1ª página) não traz "PIS/COFINS" literal mas
        # o assunto CNJ do DataJud é "Não Cumulatividade; Crédito Presumido".
        # exige ICMS explícito: crédito presumido de IPI é OUTRA tese (e não está
        # no catálogo). Sem isso um MS sobre "Exclusão - IPI | Não Cumulatividade"
        # da Três Corações foi cravado como incentivo de ICMS.
        ("NÃO TRIBUTAÇÃO DOS INCENTIVOS FISCAIS DE ICMS PELO IRPJ, CSLL, PIS E COFINS",
         {"all": ["ICMS"],
          # PLURAL: a ementa quase sempre diz "créditos presumidos" — o token singular
          # "CREDITO PRESUMIDO" (\b) não casava e a tese caía em sugerida.
          "any2": ["CREDITO PRESUMIDO", "CREDITOS PRESUMIDOS"],
          "any": ["PIS", "COFINS", "NAO CUMULATIVIDADE"], "conf": "alta"}),
        ("NÃO TRIBUTAÇÃO DOS INCENTIVOS FISCAIS DE ICMS PELO IRPJ, CSLL, PIS E COFINS",
         {"any": ["INCENTIVO FISCAL", "INCENTIVOS FISCAIS", "SUBVENCAO", "SUBVENCOES",
                  "BENEFICIO FISCAL", "BENEFICIOS FISCAIS"],
          "hint": ["ICMS"], "conf": "alta"}),
        # teses do PDF que estavam no catálogo mas SEM regra de classificação —
        # por isso caíam em "tributário, fora do catálogo".
        # ICMS-ST: CRÉDITO (substituído aproveita o ST pago pelo substituto) vem
        # ANTES da de exclusão da base — são objetos diferentes.
        # "CREDIT" era token TRUNCADO e o casamento é por palavra inteira: não casava
        # em "créditos"/"creditamento", então esta regra nunca disparava e o processo
        # caía na de EXCLUSÃO do ICMS-ST (objeto oposto: creditar x excluir da base).
        ("CREDITAMENTO DE PIS E COFINS SOBRE O ICMS-ST PAGO PELO SUBSTITUTO",
         {"any": ["CREDITO", "CREDITOS", "CREDITAMENTO", "CREDITAR", "APROVEITAR"],
          "any2": ["ICMS-ST", "ICMS ST", "SUBSTITUTO", "SUBSTITUIDO",
                   "SUBSTITUICAO TRIBUTARIA"], "conf": "alta"}),
        ("EXCLUSÃO DO ICMS-ST DA BASE DE CÁLCULO DO PIS E DA COFINS",
         {"any": ["ICMS-ST", "ICMS ST", "SUBSTITUICAO TRIBUTARIA", "SUBSTITUIDO"],
          "hint": ["PIS", "COFINS"], "conf": "alta"}),
        # ISS excluído da base do IRPJ/CSLL no LUCRO PRESUMIDO — DISTINTO do Tema 118
        # (que é ISS ↔ PIS/COFINS). Objeto: o ISS destacado na NF fora da base presumida
        # do IRPJ/CSLL. Vem ANTES do 118: a regra do 118 tem "BASE DE CALCULO" no `any`
        # e casaria ISS+base mesmo sendo IRPJ/CSLL. `nao:[PIS,COFINS]` manda a variante
        # PIS/COFINS pro 118. Tese do 0803962-07.2021 (PG Prime), aprovada pelo usuário.
        ("EXCLUSÃO DO ISS DA BASE DE CÁLCULO DO IRPJ E DA CSLL (LUCRO PRESUMIDO)",
         {"all": ["ISS"],
          "any2": ["IRPJ", "CSLL", "LUCRO PRESUMIDO", "INCIDENCIA SOBRE LUCRO",
                   "IMPOSTO DE RENDA", "CONTRIBUICAO SOCIAL SOBRE O LUCRO"],
          "nao": ["PIS", "COFINS"], "conf": "alta"}),
        ("EXCLUSÃO DO ISS DA BASE DE CÁLCULO DO PIS E DA COFINS (TEMA 118)",
         {"all": ["ISS"], "any": ["PIS", "COFINS", "BASE DE CALCULO", "TEMA 118"], "conf": "alta"}),
        # a tese é gorjeta FORA da base do PIS/COFINS (restaurante/hotelaria — a gorjeta
        # é do empregado, não receita do estabelecimento). "GORJETA" sozinho casava a
        # gorjeta citada na definição de SALÁRIO (CLT 457) de uma ação de CPP/folha
        # (AFICAL 0808359: "integram o salário... inclusive as gorjetas"). Exige PIS/COFINS.
        ("EXCLUSÃO DA GORJETA DA BASE DE CÁLCULO DO PIS E DA COFINS",
         {"any": ["GORJETA", "GORJETAS"], "any2": ["PIS", "COFINS"], "conf": "alta"}),
        # PAT — Decreto 10.854/2021 limitou a dedução do Programa de Alimentação
        # do Trabalhador; a tese afasta a limitação.
        ("MANUTENÇÃO DA DEDUÇÃO DO PAT (DECRETO 10.854/2021)",
         {"any": ["PAT", "PROGRAMA DE ALIMENTACAO DO TRABALHADOR", "DECRETO 10.854",
                  "10.854"], "conf": "alta"}),
        # Aprendizes fora da base da CPP/terceiros/RAT
        ("EXCLUSÃO DOS APRENDIZES DA BASE DA CPP, TERCEIROS E RAT",
         {"any": ["APRENDIZ", "APRENDIZES", "MENOR APRENDIZ"], "conf": "alta"}),
        # Tema 69 do STF — ICMS fora da base do PIS/COFINS (a tese mais clássica)
        # Tema 69: incluir as grafias NATURAIS da ementa ("exclusão DO ICMS", "ICMS
        # não integra/compõe") além da grafia do DataJud ("EXCLUSAO - ICMS"). Sem
        # elas, um MS de exclusão do ICMS caía na genérica "PIS/COFINS própria base"
        # (CAICO 0802431-22). Exige contexto PIS/COFINS (any2) — distingue do ICMS
        # "por dentro" (ICMS na base do próprio ICMS, sem PIS/COFINS).
        ("EXCLUSÃO DO ICMS DA BASE DE CÁLCULO DO PIS E DA COFINS (TEMA 69)",
         {"all": ["ICMS"],
          "any": ["TEMA 69", "EXCLUSAO - ICMS", "EXCLUSAO DO ICMS", "EXCLUIR O ICMS",
                  "ICMS FORA DA BASE", "ICMS NAO INTEGRA", "ICMS NAO COMPOE",
                  # "ICMS destacado na nota fiscal" é o conceito-núcleo do Tema 69
                  # (o RE 574.706 decidiu pelo ICMS destacado). Pega ementas com
                  # frasagem invertida/confusa que não têm "exclusão do ICMS" literal
                  # (O MOVELEIRO 0805230: "exclusão de PIS/COFINS da base do ICMS destacado").
                  "ICMS DESTACADO", "ICMS DA NOTA FISCAL",
                  "FATURAMENTO", "RECEITA BRUTA"],
          "any2": ["PIS", "COFINS"], "conf": "alta"}),
        # PIS/COFINS sobre RECEITAS FINANCEIRAS (Decreto 8.426/2015 restabeleceu
        # as alíquotas por decreto). Vem antes da genérica de "própria base".
        ("NÃO INCIDÊNCIA DE PIS E COFINS SOBRE RECEITAS FINANCEIRAS",
         {"any": ["RECEITAS FINANCEIRAS", "RECEITA FINANCEIRA", "DECRETO 8.426",
                  "8.426"], "conf": "alta"}),
        # crédito presumido de ICMS fora da base do IRPJ/CSLL (sem PIS/COFISN acima)
        # o nome da tese diz ICMS — a regra tem de exigir. Crédito presumido de
        # IPI é outra tese (e não está no catálogo): melhor cair em "a mapear".
        ("EXCLUSÃO DA INCIDÊNCIA DO IRPJ E DA CSLL SOBRE OS CRÉDITOS PRESUMIDOS DE ICMS",
         {"all": ["ICMS"],
          "any2": ["CREDITO PRESUMIDO", "CREDITOS PRESUMIDOS"], "conf": "alta"}),
        # creditamento PIS/COFINS sobre ICMS na aquisição (exige AQUISICAO p/ não
        # colidir com crédito presumido)
        ("CREDITAMENTO DE PIS E COFINS SOBRE O ICMS NA AQUISIÇÃO DE MERCADORIAS",
         {"all": ["AQUISICAO"], "any": ["PIS", "COFINS"], "hint": ["ICMS", "CREDIT"], "conf": "alta"}),
        # IPI — exclusão do IPI da base do PIS/COFINS (indústria: bebidas, etc.)
        ("EXCLUSÃO DO IPI DA BASE DE CÁLCULO DO PIS E DA COFINS",
         {"any": ["IPI", "IMPOSTO SOBRE PRODUTOS INDUSTRIALIZADOS"],
          "nao": ["CREDITO PRESUMIDO", "CREDITOS PRESUMIDOS"], "conf": "alta"}),
        # ICMS "por dentro" — exclusão do ICMS da própria base de cálculo
        ("EXCLUSÃO DO ICMS DA PRÓPRIA BASE DE CÁLCULO (ICMS POR DENTRO)",
         {"all": ["ICMS"], "any": ["POR DENTRO", "PROPRIA BASE", "NA PROPRIA BASE", "NA SUA BASE"],
          "conf": "alta"}),
        # MAJORAÇÃO de 10% do IRPJ sobre o LUCRO PRESUMIDO. EXIGE "lucro presumido":
        # o token "MAJORACAO"/"ADICIONAL DE 10" sozinho casava o ADICIONAL DE 10% do
        # FGTS (Contribuição Social da LC 110/2001) e "majoração" solto em ementa de
        # 1/3 de férias — falsos-positivos reais (25/07). Veta FGTS/LC 110 por garantia.
        ("MAJORAÇÃO DE 10% SOBRE O LUCRO PRESUMIDO",
         {"all": ["LUCRO PRESUMIDO"],
          "any": ["ADICIONAL DE 10", "ADICIONAL DO IRPJ", "ADICIONAL DO IMPOSTO DE RENDA",
                  "MAJORACAO", "ADICIONAL"],
          "nao": ["FGTS", "LC 110", "110/2001", "LEI COMPLEMENTAR 110", "LEI COMPLEMENTAR N 110"],
          "hint": ["IRPJ"], "conf": "media"}),
        # GENÉRICA (por último): PIS/COFINS na PRÓPRIA base (o "filhote" do Tema 69 —
        # PIS/COFINS não integram a própria base de cálculo). ANTES era `any:[PIS,COFINS]`
        # — larga demais: casava QUALQUER ementa citando "PIS/COFINS base de cálculo",
        # inclusive Tema 962/SELIC (ASPERBRAS: "IRPJ/CSLL sobre SELIC... PIS/COFINS base...
        # INCIDÊNCIA DEVIDA") e Tema 69 disfarçado. Agora exige o sinal de AUTO-exclusão
        # (excluir o PIS/COFINS da PRÓPRIA base) e veta SELIC. Genuína (RECICLA):
        # "EXCLUSÃO DAS CONTRIBUIÇÕES DAS RESPECTIVAS BASES-DE-CÁLCULO".
        ("EXCLUSÃO DO PIS E DA COFINS DA SUA BASE DE CÁLCULO",
         {"all": ["BASE DE CALCULO"],
          "any": ["EXCLUSAO DO PIS E DA COFINS", "EXCLUSAO DAS CONTRIBUICOES",
                  "EXCLUIR O PIS E A COFINS", "RESPECTIVAS BASES", "PROPRIA BASE",
                  "PIS E DA COFINS DA SUA", "PIS E A COFINS DA BASE", "SOBRE SI MESM",
                  "NA BASE DELAS", "DA BASE DE CALCULO DELAS"],
          "nao": ["SELIC"], "conf": "media"}),
    ]


def _norm(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").upper())
                   if unicodedata.category(c) != "Mn")


def assunto_tributario(assunto):
    """O assunto é matéria TRIBUTÁRIA? O assunto do CNJ vem hierarquizado
    ('DIREITO TRIBUTÁRIO|...' / 'DIREITO ADMINISTRATIVO|...'). Quando o ramo é
    ADMINISTRATIVO e não há ramo tributário junto, NÃO é tese nossa — antes
    entravam licitação, contrato administrativo e equilíbrio financeiro."""
    a = _norm(assunto)
    if "DIREITO ADMINISTRATIVO" in a and "DIREITO TRIBUTARIO" not in a:
        return False
    return any(k in a for k in ASSUNTO_TRIB)


def objeto_administrativo(assunto):
    """True p/ objetos administrativos específicos (CND/certidão de regularidade):
    são situações pontuais, não teses (direito geral garantido)."""
    a = _norm(assunto)
    return any(k in a for k in ASSUNTO_ADMINISTRATIVO)


# Corroboração: por FAMÍLIA de tese (marcador no nome), quais keywords no ASSUNTO
# do DataJud confirmam a classificação vinda da petição. Ordem = específico->genérico.
CORROB = [
    ("PERSE",                      ["PERSE", "SETOR DE EVENTOS", "PROGRAMA EMERGENCIAL", "ISENCAO", "BENEFICIO"]),
    ("HOSPITAIS",                  ["HOSPITALAR", "SAUDE", "IRPJ", "CSLL", "LUCRO PRESUMIDO"]),
    ("TERCO",                      ["TERCO", "FERIAS", "SALARIO DE CONTRIBUICAO", "CONTRIBUICAO"]),
    ("IRRF",                       ["IRRF", "RETIDO", "IMPOSTO DE RENDA"]),
    ("CREDITAMENTO",               ["CREDITO", "AQUISICAO", "NAO CUMULATIVIDADE", "INSUMO"]),
    ("ICMS-ST",                    ["SUBSTITUICAO TRIBUTARIA", "ICMS-ST", "ICMS ST"]),
    ("IPI",                        ["IPI", "PRODUTOS INDUSTRIALIZADOS"]),
    ("POR DENTRO",                 ["ICMS", "POR DENTRO", "BASE DE CALCULO"]),
    ("CREDITOS PRESUMIDOS",        ["CREDITO PRESUMIDO", "INCENTIVO", "INCENTIVOS", "SUBVENCAO",
                                    "SUBVENCOES", "BENEFICIO FISCAL", "BENEFICIOS FISCAIS",
                                    "ICMS"]),
    # "NAO CUMULATIVIDADE" sozinha NÃO confirma: ela aparece em assunto de IPI
    # ("IPI | Não Cumulatividade") e fazia um caso de IPI ser cravado como ICMS.
    # O que confirma é o incentivo/crédito presumido ou o próprio ICMS.
    ("INCENTIVOS FISCAIS DE ICMS", ["CREDITO PRESUMIDO", "INCENTIVO", "INCENTIVOS", "SUBVENCAO",
                                    "SUBVENCOES", "BENEFICIO FISCAL", "BENEFICIOS FISCAIS",
                                    "ICMS"]),
    ("20 SALARIOS MINIMOS",        ["INCRA", "SEBRAE", "SENAI", "SENAC", "SESC", "SESI",
                                    "SALARIO EDUCACAO", "TERCEIROS", "CORPORATIVAS",
                                    "CONTRIBUICAO", "CONTRIBUICOES"]),
    ("VALORES RETIDOS DO SEGURADO", ["CONTRIBUICAO", "PREVIDENCIARIA", "FOLHA", "RAT",
                                     "SALARIO DE CONTRIBUICAO", "IMPOSTO DE RENDA"]),
    ("PAT",                        ["PAT", "ALIMENTACAO", "IRPJ", "LUCRO",
                                    "INCIDENCIA SOBRE LUCRO"]),
    ("APRENDIZES",                 ["APRENDIZ", "APRENDIZES", "CONTRIBUICAO", "CONTRIBUICOES",
                                    "FOLHA", "RAT", "TERCEIROS", "PREVIDENCIARIA",
                                    "PREVIDENCIARIAS", "FOLHA DE SALARIOS"]),
    # "RAT" tem de vir DEPOIS de APRENDIZES e VALORES RETIDOS: os nomes dessas
    # duas teses terminam em "E RAT", e o primeiro marcador que casa vence.
    ("RAT",                        ["RAT", "GILRAT", "FAP", "ATIVIDADE PREPONDERANTE",
                                    "GRAU DE RISCO", "ACIDENTE", "CONTRIBUICAO SOBRE A FOLHA"]),
    ("TEMA 69",                    ["ICMS", "EXCLUSAO - ICMS", "BASE DE CALCULO", "PIS",
                                    "COFINS", "FATURAMENTO"]),
    ("RECEITAS FINANCEIRAS",       ["PIS", "COFINS", "RECEITA", "RECEITAS", "FINANCEIRA",
                                    "FINANCEIRAS", "NAO CUMULATIVIDADE"]),
    ("ISS",                        ["ISS", "SERVICO"]),
    ("MAJORACAO",                  ["LUCRO PRESUMIDO", "ADICIONAL", "MAJORACAO", "IRPJ"]),
    ("PIS E DA COFINS DA SUA BASE",["PIS", "COFINS", "BASE DE CALCULO", "NAO CUMULATIVIDADE"]),
    # o casamento é por PALAVRA INTEIRA: "CONTRIBUICAO" não casa em
    # "CONTRIBUIÇÕES", e o assunto do CNJ vem quase sempre no plural. Faltavam os
    # plurais e as próprias verbas — por isso o salário-maternidade da P J caía
    # como "assunto não confirma" mesmo com o assunto dizendo Salário-Maternidade.
    ("VERBAS INDENIZATORIAS",      ["CONTRIBUICAO", "CONTRIBUICOES", "PREVIDENCIARIA",
                                    "PREVIDENCIARIAS", "FOLHA", "SALARIO DE CONTRIBUICAO",
                                    "SALARIO-MATERNIDADE", "SALARIO MATERNIDADE",
                                    "MATERNIDADE", "AUXILIO-CRECHE", "AUXILIO CRECHE",
                                    "AVISO PREVIO", "FERIAS", "TERCO", "INDENIZATORIA",
                                    "INDENIZATORIAS"]),
]


def assunto_corrobora(tese, assunto):
    """A classificação (vinda da petição) é CONFIRMADA pelo assunto do DataJud?
    Assunto vazio (processo novo não indexado / consulta falhou) => NÃO corrobora
    (conservador: cravar só quando há confirmação independente). Sem regra p/ a
    família => não bloqueia (True)."""
    a = _norm(assunto)
    if not a.strip():
        return False
    tn = _norm(tese or "")
    # PALAVRA INTEIRA também no marcador: com substring, "PAT" casava dentro de
    # "PATRONAL" e a tese de CPP sobre verbas indenizatórias era conferida contra
    # as keywords do PAT (alimentação/IRPJ/lucro) — nunca corroborava.
    for marcador, kws in CORROB:
        if _tem(_norm(marcador), tn):
            return any(_tem(k, a) for k in kws)
    return True


def _tem(tok, texto):
    r"""Casa TOKEN como PALAVRA INTEIRA (\b...\b). Substring cru dava falso-positivo
    grave: 'RAT' casava em 'conTRATo'/'adminisTRATivo', 'SAT' em 'SATisfação',
    'ISS' em 'comISSão', 'IPI' em 'municÍPIo'. Assim só casa o token isolado."""
    return re.search(r"\b" + re.escape(tok) + r"\b", texto) is not None


def classificar_tese(assunto, classe, catalogo_norm, peticao=""):
    """Retorna (nome_tese_do_catalogo | None, confianca). Casa contra assunto CNJ
    + classe + TEXTO DA PETIÇÃO (o objeto real; o assunto CNJ engana)."""
    # objeto administrativo específico (CND/certidão) não é tese, mesmo que a
    # petição cite um tributo — o objeto é o ato pontual, não um direito geral.
    if objeto_administrativo(assunto):
        return None, None
    texto = _norm(assunto) + " " + _norm(classe) + " " + _norm(peticao)
    cl = _norm(classe)
    for nome, rg in regras_tese():
        if _norm(nome) not in catalogo_norm:
            continue  # tese não está no catálogo do escritório
        # algumas teses só existem em certa CLASSE processual (ex.: rescisória só
        # é protocolada no 2º grau). Sem esse gate, a regra da rescisória casava
        # "1/3 de férias" e sequestrava ação de 1º grau sobre verbas indenizatórias.
        if "classe" in rg and not any(t in cl for t in rg["classe"]):
            continue
        if "all" in rg and not all(_tem(t, texto) for t in rg["all"]):
            continue
        if "any" in rg and not any(_tem(t, texto) for t in rg["any"]):
            continue
        # segundo grupo obrigatório: quando a tese exige DUAS ideias presentes, cada
        # uma com várias grafias (ex.: creditar + ICMS-ST). "all" não serve porque
        # exigiria TODAS as grafias de uma vez.
        if "any2" in rg and not any(_tem(t, texto) for t in rg["any2"]):
            continue
        # veto: termo que DESCARACTERIZA a tese. "Crédito presumido de IPI" é
        # ressarcimento na exportação (Lei 9.363/96) — outra tese, fora do
        # catálogo — e estava sendo lida como "exclusão do IPI da base".
        if "nao" in rg and any(_tem(t, texto) for t in rg["nao"]):
            continue
        # confiança base da regra; hint presente sobe "media" -> "alta"
        conf = rg.get("conf", "media")
        if conf == "media" and any(_tem(t, texto) for t in rg.get("hint", [])):
            conf = "alta"
        return nome, conf
    return None, None


# ---------------------------------------------------------------------------
# Classificação pelos PEDIDOS (23/07) — o OBJETO real da ação está nos pedidos
# finais, não no corpo argumentativo, que cita precedentes (o RE 574.706/Tema 69
# aparece como fundamento em quase toda ação de "exclusão da base" e puxava o
# match pra ICMS mesmo em ação de CPP/ISS). Camadas: pedidos > peça > assunto.
# ---------------------------------------------------------------------------
_JURIS_RE = re.compile(
    r"(\bRE\s*\d[\d.\-/]*|\bRESP\b|RECURSO\s+(?:ESPECIAL|EXTRAORDIN)|\bTEMA\s*\d+|"
    r"S[ÚU]MULA|MINISTR[OA]|DESEMBARGADOR|RELATOR[AiI]?|\bSTF\b|\bSTJ\b|\bTRF\b|"
    r"574\.?706|julgamento:|\bRel\.|repercuss[ãa]o geral|paradigma)", re.I)
_FECHO_RE = re.compile(
    r"(pede[- ]?se?\s+(?:e\s+espera\s+)?deferimento|termos?\s+em\s+que|"
    r"nestes?\s+termos|\bp\.?\s*deferimento\b|pede\s+e\s+espera)", re.I)
_PED_INI_RE = re.compile(
    r"(DOS?\s+PEDIDOS?|ANTE\s+O\s+EXPOSTO|DIANTE\s+DO\s+EXPOSTO|ISTO\s+POSTO|"
    r"REQUER[,:]?\s+(?:a\b|ao\b|se\b|,|ainda|portanto|então)|"
    r"SEJA\s+(?:CONCEDID|DECLARAD|RECONHECID|JULGAD)|OBJETO\b.{0,40}PEDIDO\b)", re.I)
_PROCED_RE = re.compile(
    r"(certid[ãa]o de|expedi[çc][ãa]o de of[íi]cio|habilita[çc][ãa]o de cr[ée]dito|"
    r"cumprimento de senten|execu[çc][ãa]o do julgado|penhora|levantamento de|"
    r"objeto e p[ée]|intima[çc][õo]es?\b[^.]{0,60}\bem nome\b)", re.I)
_MERITO_RE = re.compile(
    r"declar|reconhec|inexig|inconstitucional|il[eé]gal|direito de\s+(?:excluir|n[ãa]o|"
    r"compensar|creditar|restitu|deduzir)|afast|exclus[ãa]o d", re.I)


def zona_pedidos(texto):
    """Bloco dos PEDIDOS FINAIS: do último marcador de pedido até o fecho
    ('pede deferimento'), sem a assinatura/rodapé nem o corpo argumentativo."""
    t = texto or ""
    fechos = list(_FECHO_RE.finditer(t))
    fim = fechos[-1].start() if fechos else len(t)
    corpo = t[:fim]
    inis = list(_PED_INI_RE.finditer(corpo))
    ini = inis[-1].start() if inis else max(0, fim - 2000)
    return corpo[ini:fim]


def strip_jurisprudencia(texto):
    """Remove as frases que citam precedente — senão o RE 574.706 (Tema 69),
    fundamento de quase toda ação de exclusão da base, contamina o match."""
    frases = re.split(r"(?<=[.;])\s+", texto or "")
    limpo = " ".join(f for f in frases if not _JURIS_RE.search(f))
    return limpo


def pedido_procedimental(zona):
    """A zona é de uma petição POSTERIOR (execução/certidão/habilitação), não da
    inicial de mérito? Nesses casos o objeto não é a tese."""
    z = zona or ""
    return bool(_PROCED_RE.search(z)) and not _MERITO_RE.search(z)


def classificar_por_pedidos(assunto, classe, catalogo_norm, peticao):
    """(tese, conf, fonte) priorizando os PEDIDOS FINAIS (jurisprudência removida).
    fonte ∈ {'pedidos','peça','assunto'}. Cai pra peça/assunto quando os pedidos
    não decidem (peça posterior, ou nenhuma regra casou)."""
    if peticao and peticao_valida(peticao):
        z = zona_pedidos(peticao)
        if not pedido_procedimental(z):
            tese, _ = classificar_tese("", "", catalogo_norm, strip_jurisprudencia(z))
            if tese:
                return tese, "alta", "pedidos"
    tese, conf = classificar_tese(assunto, classe, catalogo_norm, peticao)
    fonte = "peça" if (peticao and peticao_valida(peticao)) else "assunto"
    return tese, conf, fonte


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cnpj", help="CNPJ único a analisar")
    ap.add_argument("--cnpjs", help="lista de CNPJs separados por vírgula (1 login, N empresas)")
    ap.add_argument("--acao", metavar="ACAO_ID", help="analisa TODAS as empresas de uma ação (via elegibilidade)")
    ap.add_argument("--fila", action="store_true",
                    help="PROTOCOLO PADRÃO: consome as empresas que a UI marcou como pendentes "
                         f"(botão 'Analisar teses'), com --graus {PROTOCOLO_PADRAO}")
    ap.add_argument("--limit", type=int, default=200, help="máx de empresas no modo --acao")
    ap.add_argument("--autos", action="store_true",
                    help="abre os autos dos candidatos p/ ler o assunto CNJ e cravar a tese exata "
                         "(gasta abertura de autos — sujeito ao limite diário do TJRN)")
    ap.add_argument("--gravar", action="store_true",
                    help="persiste os candidatos em empresa_processos_tributarios (visível no CRM)")
    ap.add_argument("--inspect", action="store_true",
                    help="1ª vez: loga, dumpa os campos do form + linhas cruas de resultado e sai")
    ap.add_argument("--graus", default="1g,2g,1gf,2gf",
                    help="graus: 1g/2g=TJRN estadual, 1gf/2gf=TRF5 federal PJe 2.x, "
                         "1x=PJe 1.x da Seção Judiciária da UF da empresa (jfrn/jfpb/jfpe/jfal/jfse/jfce), "
                         "2x=PJe 1.x do 2º grau (trf5)")
    ap.add_argument("--cdp", action="store_true",
                    help="conecta no Chrome REAL (via chrome-cdp.ps1) — NECESSÁRIO pro A3 federal "
                         "(TRF5/PDPJ): o Chromium do Playwright não apresenta o certificado no SSO")
    ap.add_argument("--port", type=int, default=9222, help="porta CDP (default 9222)")
    ap.add_argument("--sem-cache", action="store_true",
                    help="ignora o cache de petições e rebaixa tudo do PJe (use só se "
                         "suspeitar de extração truncada/errada)")
    ap.add_argument("--ementa", action="store_true",
                    help="lê a SENTENÇA/ementa (1.x) como sinal AUTORITATIVO do objeto "
                         "da tese — desambigua ICMS x CPP x creditamento")
    args = ap.parse_args()
    if args.sem_cache:
        global USAR_CACHE
        USAR_CACHE = False
    if args.ementa:
        global LER_SENTENCA
        LER_SENTENCA = True
    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("ERRO: rode `. tools\\pje-env.local.ps1` antes.")

    # ---- monta a lista de CNPJs alvo (fila da UI / single / lista / ação) ----
    alvos = []  # [cnpj_digits]
    fila_map = {}  # cnpj_digits -> empresa_id (só no modo --fila, p/ mover o status)
    if args.fila:
        if args.graus == ap.get_default("graus"):
            args.graus = PROTOCOLO_PADRAO  # protocolo padrão quando não sobrescrito
        rows = sb("empresas?select=id,cnpj,nome&teses_status=eq.pendente"
                  f"&order=teses_solicitada_em.asc&limit={args.limit}")
        for r in rows:
            c = re.sub(r"\D", "", r.get("cnpj") or "")
            if len(c) == 14:
                alvos.append(c); fila_map[c] = r["id"]
        print(f"[fila] {len(alvos)} empresa(s) pendente(s) | graus={args.graus}")
    elif args.acao:
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
        sys.exit("Nada a analisar. Passe --fila (protocolo pedido na UI), --cnpj, --cnpjs ou --acao.")

    cat_rows = sb("acoes_tributarias?select=id,nome&status=eq.Ativa")
    catalogo = [r["nome"] for r in cat_rows]
    catalogo_norm = {_norm(n): n for n in catalogo}          # norm(nome) -> nome (tese no catálogo)
    global TESE_ID
    TESE_ID = {_norm(r["nome"]): r["id"] for r in cat_rows}  # norm(nome) -> acao_id (p/ gravar)
    print(f"{len(alvos)} empresa(s) a analisar | catálogo: {len(catalogo)} teses")

    from playwright.sync_api import sync_playwright
    graus_validos = set(GRAUS) | {"1x", "2x"}
    graus = [g.strip() for g in args.graus.split(",") if g.strip() in graus_validos]

    with sync_playwright() as p:
        if args.cdp:
            # Chrome REAL (chrome-cdp.ps1) — onde o A3 federal já foi logado.
            # 127.0.0.1 e NÃO "localhost": o Chrome escuta só em IPv4, mas
            # "localhost" pode resolver primeiro para ::1 e a conexão falha com
            # "ECONNREFUSED" mesmo com o browser vivo e a porta aberta.
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{args.port}")
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        else:
            ctx = p.chromium.launch_persistent_context(PROFILE, headless=False,
                                                       viewport={"width": 1360, "height": 940})
        def _aceitar(d):
            try: d.accept()
            except Exception: pass
        ctx.on("page", lambda pg: pg.on("dialog", _aceitar))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("dialog", _aceitar)

        # LOGIN UMA VEZ (na 1ª busca); depois roda todos os CNPJs na mesma sessão.
        # login inicial: se o 1º grau é o 1.x (instância por seção), resolve pela
        # UF da PRIMEIRA empresa — senão cairia no domínio errado e daria timeout.
        # Cada instância seguinte pede o seu próprio A3 no _garantir_form.
        login_url = GRAUS.get(graus[0])
        if not login_url:
            if graus[0] == "2x":
                login_url = PJE_1X_2G
            else:
                c0 = alvos[0]
                f0 = f"{c0[0:2]}.{c0[2:5]}.{c0[5:8]}/{c0[8:12]}-{c0[12:14]}"
                e0 = sb(f"empresas?select=uf&or=(cnpj.eq.{urllib.parse.quote(f0)},cnpj.eq.{c0})")
                uf0 = ((e0[0].get("uf") if e0 else "") or "").upper()
                login_url = PJE_1X.get(uf0) or PJE_1X_2G
                print(f">>> PJe 1.x da seção {uf0 or '?'}: {login_url.split('/')[2]}", flush=True)
        page = _login_once(ctx, page, login_url)
        if page is None:
            print("Timeout aguardando login."); return

        for i, cnpj_digits in enumerate(alvos, 1):
            print(f"\n———— [{i}/{len(alvos)}] ————", flush=True)
            eid = fila_map.get(cnpj_digits)
            if eid:
                try: sb_patch(f"empresas?id=eq.{eid}", {"teses_status": "processando"})
                except Exception: pass
            try:
                with cron("empresa", cnpj=cnpj_digits, graus=",".join(graus)):
                    _processar_cnpj(page, ctx, cnpj_digits, graus, catalogo, catalogo_norm,
                                    args.inspect, args.autos, args.gravar)
                # CARIMBA SEMPRE, não só no modo --fila. Empresa sem candidato não
                # deixa linha em empresa_processos_tributarios, então parecia nunca
                # ter sido varrida e voltava na fila do próximo lote — M. Dias
                # Branco foi rodada 4 vezes à toa.
                alvo_id = eid or _empresa_id_por_cnpj(cnpj_digits)
                if alvo_id:
                    sb_patch(f"empresas?id=eq.{alvo_id}", {
                        "teses_status": "concluido", "teses_analisada_em": _agora(),
                        "teses_erro": None})
            except Exception as e:
                print(f"  [erro] {cnpj_digits}: {type(e).__name__}: {str(e)[:200]}", flush=True)
                if eid:
                    try:
                        sb_patch(f"empresas?id=eq.{eid}", {
                            "teses_status": "erro", "teses_erro": f"{type(e).__name__}: {str(e)[:400]}"})
                    except Exception: pass
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
    print(">>> Se pedir, faça LOGIN A3 na janela do Chrome (aguardando o form de consulta)...", flush=True)
    for _ in range(300):  # ~10 min
        for pg in list(ctx.pages):
            try:
                if pg.query_selector(SEL_FORM):
                    print(">>> Autenticado.", flush=True)
                    return pg
            except Exception:
                pass
        # Re-navega ao form QUALQUER aba PJe já autenticada (não só tjrn): no
        # FEDERAL, após o SSO a aba cai no QuadroAviso e nunca mostra o form
        # sozinha. Só re-navega quem NÃO está em tela de login (recarregar por
        # baixo do A3 impede o certificado).
        alvo = None
        for pg in list(ctx.pages):
            try:
                u = (pg.url or "").lower()
                if (("pje" in u) or ("jus.br" in u)) and not any(m in u for m in LOGIN_MARKERS):
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
        # Após o login, a aba federal cai no QuadroAviso e não volta ao form
        # sozinha — re-navega qualquer aba PJe já autenticada (não em login).
        if i >= 6 and i % 4 == 0:
            for pg in list(ctx.pages):
                try:
                    u = (pg.url or "").lower()
                    if (("pje" in u) or ("jus.br" in u)) and not any(m in u for m in LOGIN_MARKERS):
                        pg.goto(url, wait_until="domcontentloaded"); break
                except Exception:
                    pass
        page.wait_for_timeout(1000)
    return None


def _empresa_id_por_cnpj(cnpj_digits):
    """id da empresa no CRM a partir do CNPJ (formatado ou só dígitos)."""
    f = (f"{cnpj_digits[0:2]}.{cnpj_digits[2:5]}.{cnpj_digits[5:8]}"
         f"/{cnpj_digits[8:12]}-{cnpj_digits[12:14]}")
    try:
        r = sb(f"empresas?select=id&or=(cnpj.eq.{urllib.parse.quote(f)},"
               f"cnpj.eq.{cnpj_digits})&limit=1")
        return r[0]["id"] if r else None
    except Exception:
        return None


def _dv_cnpj(base12):
    """Dígitos verificadores de um CNPJ (mod 11) — para montar o CNPJ da matriz."""
    def _d(nums, pesos):
        s = sum(int(n) * p for n, p in zip(nums, pesos))
        r = s % 11
        return "0" if r < 2 else str(11 - r)
    d1 = _d(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    d2 = _d(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return d1 + d2


def _cnpjs_a_buscar(cnpj_digits):
    """O CNPJ alvo e, se ele for FILIAL, também o da MATRIZ.

    Teses tributárias são ajuizadas pela matriz — é a mesma pessoa jurídica. Sem
    isto, filial de grande grupo retornava 0 processo e a empresa entrava no CRM
    como 'nunca ajuizou tese', o oposto da verdade.
    """
    alvos = [cnpj_digits]
    if len(cnpj_digits) == 14 and cnpj_digits[8:12] != "0001":
        base = cnpj_digits[:8] + "0001"
        alvos.append(base + _dv_cnpj(base))
    return alvos


def _url_do_grau(grau, uf):
    """Resolve a URL do grau. '1x' = PJe 1.x da Seção Judiciária da UF da empresa
    (instância própria por estado); '2x' = PJe 1.x do 2º grau (TRF5)."""
    if grau == "1x":
        return PJE_1X.get((uf or "").strip().upper())
    if grau == "2x":
        return PJE_1X_2G
    return GRAUS.get(grau)


def _processar_cnpj(page, ctx, cnpj_digits, graus, catalogo, catalogo_norm, inspect, autos=False, gravar=False):
    cnpj_fmt = f"{cnpj_digits[0:2]}.{cnpj_digits[2:5]}.{cnpj_digits[5:8]}/{cnpj_digits[8:12]}-{cnpj_digits[12:14]}"
    emp = sb(f"empresas?select=id,nome,razao_social,uf&or=(cnpj.eq.{urllib.parse.quote(cnpj_fmt)},cnpj.eq.{cnpj_digits})")
    empresa = emp[0] if emp else None
    empresa_id = (empresa or {}).get("id")
    uf = (empresa or {}).get("uf") or ""
    razao = (empresa or {}).get("razao_social") or (empresa or {}).get("nome") or ""
    print(f"CNPJ {cnpj_fmt} | {razao or '(não está no CRM)'}", flush=True)

    todos = {}
    for grau in graus:
        url = _url_do_grau(grau, uf)
        if not url:
            print(f"[{grau}] sem instância PJe 1.x para a UF '{uf or '?'}' "
                  f"(TRF5 cobre {'/'.join(PJE_1X)}) — pulando este grau.")
            continue
        with cron("form", grau=grau, cnpj=cnpj_digits):
            pg = _garantir_form(page, ctx, url, grau)
        if pg is None:
            print(f"[{grau}] form indisponível (login não concluído nesta instância) — pulando este grau.")
            continue
        page = pg  # usa a aba onde o form apareceu (login federal pode abrir outra)
        if inspect:
            campos = page.evaluate(r"""() => [...document.querySelectorAll('input,select')]
                .map(e => ({id:e.id, name:e.name, type:e.type})).filter(e => e.id||e.name)""")
            print(f"=== [{grau}] CAMPOS ({len(campos)}) ==="); [print("  ", c) for c in campos[:40]]
        # FILIAL: a tese é ajuizada pela MATRIZ (mesma pessoa jurídica, outro
        # estabelecimento). Buscar só pelo CNPJ da filial devolvia 0 justamente
        # nas maiores empresas da base — Riachuelo, Guararapes e M. Dias Branco
        # vieram todas vazias antes disto.
        for i_cnpj, cnpj_busca in enumerate(_cnpjs_a_buscar(cnpj_digits)):
            rotulo = "matriz" if cnpj_busca != cnpj_digits else "próprio"
            if i_cnpj:
                # PÁGINA NOVA entre buscas. Reaproveitar a tela obriga o "Limpar",
                # que re-renderiza o form e RESETA o seletor CPF/CNPJ: o CNPJ é
                # preenchido mas não filtra, e o PJe devolve o ACERVO INTEIRO
                # (219 mil). Foi o que aconteceu com Guararapes e M. Dias Branco;
                # Riachuelo só escapou porque a 1ª busca voltou vazia.
                pg2 = _garantir_form(page, ctx, url, grau)
                if pg2 is None:
                    break
                page = pg2
            with cron("busca", grau=grau, cnpj=cnpj_busca, alvo=rotulo):
                achou = _buscar(page, cnpj_busca, razao)
            page.wait_for_timeout(700)
            total_dito = _total_encontrado(page)
            # TRAVA: filtro que não pegou devolve o acervo. Nenhuma empresa tem
            # milhares de processos numa seção — isso é busca sem filtro, e tratar
            # essas linhas como dela contaminaria o CRM com processo de terceiro.
            if total_dito and total_dito > 500:
                print(f"[{grau}] BUSCA SEM FILTRO ({total_dito} resultados) — "
                      f"descartando esta consulta ({rotulo}).")
                with cron("busca_sem_filtro", grau=grau, cnpj=cnpj_busca,
                          total=total_dito):
                    pass
                continue
            linhas, pagina = [], 1
            while True:
              linhas_pg = page.evaluate(r"""() => {
              const out=[];
              for (const tr of document.querySelectorAll('table tr')) {
                // SÓ linha-folha: <tr> container de tabela aninhada também casa o
                // número (do 1º processo da tabela interna) e vem ANTES no DOM —
                // o dedup ficava com ele e todas as células saíam erradas.
                if (tr.querySelector('tr')) continue;
                const m = tr.innerText.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
                if (!m) continue;
                const cells = [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g,' ').trim());
                // PJe 1.x: ícone "Ver Detalhes" -> openPopUp('..','/pje/...idProcessoTrf=N')
                let det = '';
                const img = [...tr.querySelectorAll('img')]
                  .find(e => /detalhe/i.test(e.getAttribute('title') || ''));
                if (img) {
                  const mm = (img.getAttribute('onclick') || '')
                              .match(/openPopUp\([^,]+,\s*'([^']+)'/);
                  if (mm) det = mm[1];
                }
                out.push({proc:m[0], cells, det});
              }
              return out;
            }""")
              vistos = {x["proc"] for x in linhas}
              novos = [x for x in linhas_pg if x["proc"] not in vistos]
              linhas.extend(novos)
              # vira a página enquanto faltar resultado E a página trouxer novidade
              if (not novos or not total_dito or len(linhas) >= total_dito
                      or pagina >= 20):
                  break
              # marca a página atual pra saber quando a nova terminou de montar
              JS_1A = (r"""() => { const tr = [...document.querySelectorAll('table tr')]"""
                       r""".find(t => !t.querySelector('tr') &&"""
                       r""" /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(t.innerText));"""
                       r""" return tr ? tr.innerText.slice(0, 60) : ''; }""")
              antes = page.evaluate(JS_1A)
              if not _proxima_pagina(page):
                  break
              pagina += 1
              _ate(page, JS_1A, 30, diferente_de=antes)
            paginas_txt = f" em {pagina} página(s)" if pagina > 1 else ""
            falta = (f"  [PJe informou {total_dito}]"
                     if total_dito and len(linhas) < total_dito else "")
            print(f"[{grau}] busca por {'CNPJ' if achou=='doc' else 'razão social'}"
                  f"{'' if rotulo == 'próprio' else ' da MATRIZ'}: "
                  f"{len(linhas)} linha(s){paginas_txt}{falta}")
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
                    base = "https://" + url.split("/")[2]
                    cach = _cache_ler(r["proc"])
                    # Decide se o cache responde SEM abrir autos:
                    #  - modo normal: precisa da petição (ou falha já esgotada).
                    #  - modo --ementa: a EMENTA cacheada BASTA (autoritativa, uso
                    #    direto) MESMO com a petição falha — a ementa é o sinal que
                    #    crava; ou petição-utilizável + id_trf (lê a sentença 1x).
                    #    Sem nada disso, abre o detalhe (popula id_trf + lê + cacheia).
                    if LER_SENTENCA:
                        usar_cache = bool(cach and (cach.get("sentenca")
                                          or (_cache_utilizavel(cach) and cach.get("id_trf"))))
                    else:
                        usar_cache = _cache_utilizavel(cach)
                    if usar_cache:
                        r["assunto_fonte"] = cach.get("assunto", "")
                        r["orgao_fonte"] = cach.get("orgao", "")
                        r["peticao"] = cach.get("peticao", "")
                        if cach.get("falhou"):
                            print(f"    {r['proc']}: petição não abriu em "
                                  f"{cach.get('tentativas')} tentativas — usando só o "
                                  f"assunto (--sem-cache força tentar de novo)")
                        else:
                            print(f"    {r['proc']}: petição em cache "
                                  f"({len(r['peticao'])} chars)")
                        # --ementa: usa a ementa CACHEADA (imutável) se já houver;
                        # senão lê DIRETO do idProcessoTrf cacheado e memoriza. Só
                        # gasta abertura de autos no que ainda falta.
                        if LER_SENTENCA:
                            r["sentenca"] = cach.get("sentenca") or ""
                            if not r["sentenca"] and cach.get("id_trf"):
                                r["sentenca"] = _sentenca_pdf_1x(ctx, base, cach["id_trf"])
                                _cache_sentenca(r["proc"], r["sentenca"])
                    elif r.get("det"):
                        # PJe 1.x (consulta do advogado): detalhe por URL direta
                        with cron("peticao", grau=grau, proc=r["proc"], via="detalhe"):
                            a1, o1, p1 = _detalhe_peticao_1x(ctx, base, r["det"])
                        r["assunto_fonte"], r["orgao_fonte"], r["peticao"] = a1, o1, p1
                        _m = re.search(r"idProcessoTrf=(\d+)", r["det"] or "")
                        _idt = _m.group(1) if _m else ""
                        _cache_gravar(r["proc"], a1, o1, p1, id_trf=_idt)
                        if LER_SENTENCA and _idt:
                            r["sentenca"] = _sentenca_pdf_1x(ctx, base, _idt)
                            _cache_sentenca(r["proc"], r["sentenca"])
                    elif grau in ("1x", "2x"):
                        # PJe 1.x TERCEIROS: postback + modal de motivo -> aba nova
                        with cron("peticao", grau=grau, proc=r["proc"], via="terceiros"):
                            det = _abrir_detalhe_terceiros(page, ctx, r["proc"])
                            if det is not None:
                                _idt = ""
                                try:
                                    a1, o1, p1 = _extrair_detalhe_1x(det, ctx, base)
                                    r["assunto_fonte"], r["orgao_fonte"], r["peticao"] = a1, o1, p1
                                    _m = re.search(r"idProcessoTrf=(\d+)", det.url or "")
                                    _idt = _m.group(1) if _m else ""
                                    _cache_gravar(r["proc"], a1, o1, p1, id_trf=_idt)
                                finally:
                                    try: det.close()
                                    except Exception: pass
                                if LER_SENTENCA and _idt:
                                    r["sentenca"] = _sentenca_pdf_1x(ctx, base, _idt)
                                    _cache_sentenca(r["proc"], r["sentenca"])
                    else:
                        with cron("peticao", grau=grau, proc=r["proc"], via="2x"):
                            r["peticao"] = _abrir_peticao(page, r["proc"])
                        _cache_gravar(r["proc"], "", "", r["peticao"])
                        _fechar_abas_extras(page)
                    if LER_SENTENCA:
                        # detector (opt-in) de esgotamento: registra se ESTE candidato
                        # obteve ALGUMA fonte assertiva (ementa/petição).
                        _registrar_autos(bool((r.get("sentenca") or "").strip())
                                         or peticao_valida(r.get("peticao") or ""))
                    # higiene de abas: evita acúmulo (detalhe/paginador órfãos) que
                    # degrada o expect_page e causa a flakiness de leitura no run longo.
                    _fechar_abas_extras(page)
                todos[r["proc"]] = {**r, "grau": grau}
    if inspect:
        return

    candidatos, motivos = filtrar_teses(todos, razao)
    # Crava a TESE pelo OBJETO DA PETIÇÃO (fonte da verdade — o assunto CNJ do
    # DataJud engana: PERSE vem tagado "Crédito Presumido", etc.). DataJud entra
    # como sinal complementar (classe + assunto). Petição não lida -> só assunto.
    # busca TODOS os assuntos do DataJud de uma vez (paralelo) antes do laço
    with cron("datajud", n=len(candidatos)):
        metas = datajud_lote([c["proc"] for c in candidatos])
    for c in candidatos:
        classe_dj, assuntos, _grau_dj, _org = metas.get(c["proc"], (None, [], None, None))
        # assunto DA FONTE (tela de detalhe do 1.x) tem prioridade sobre o DataJud,
        # que é notoriamente impreciso. Só cai no DataJud quando a fonte não veio.
        c["assunto"] = c.get("assunto_fonte") or ("; ".join(assuntos) if assuntos else "")
        # MULTI-SINAL — SÓ com --ementa (LER_SENTENCA). Ementa > pedidos > peça >
        # assunto. AINDA EM CALIBRAÇÃO: o leitor de sentença achou 0 no piloto e o
        # "pedidos sozinho" não bate a classificação por peça (poluição do Tema 69).
        # Por isso NÃO é o padrão — o fluxo normal mantém a classificação validada.
        if LER_SENTENCA:
            tese_em, _ = classificar_por_ementa(catalogo_norm, c.get("sentenca") or "")
            if tese_em:
                tese, conf, c["fonte_tese"] = tese_em, "alta", "ementa"
            else:
                tese, conf, c["fonte_tese"] = classificar_por_pedidos(
                    c["assunto"], classe_dj or c.get("classe") or "", catalogo_norm, c.get("peticao") or "")
            c["tese"], c["conf"] = tese, conf
        else:
            # PADRÃO VALIDADO (~74%): classifica pela peça/assunto; fonte "petição"
            # só com inicial válida (peticao_valida); senão assunto do DataJud.
            tese, conf = classificar_tese(c["assunto"], classe_dj or c.get("classe") or "",
                                          catalogo_norm, c.get("peticao", ""))
            c["tese"], c["conf"] = tese, conf
            c["fonte_tese"] = "petição" if peticao_valida(c.get("peticao") or "") else "assunto(DataJud)"
        # POLÍTICA (25/07, do usuário): NENHUMA tese é cravada só pelo ASSUNTO. O
        # assunto CNJ é genérico (engana ~1/4) e serve APENAS como COMPLEMENTO. Crava
        # (acao_id) exige FONTE DIRETA ASSERTIVA: ementa/pedidos (o juiz/o pedido
        # enunciam o objeto — autoritativas) ou a PETIÇÃO/peça (cruzada com o assunto
        # p/ conter a poluição do Tema 69). Assunto sozinho -> no máximo SUGESTÃO.
        fonte_direto = c["fonte_tese"] in ("ementa", "pedidos", "peça", "petição")
        c["fonte_direto"] = fonte_direto
        if not tese:
            c["corrob"] = False
        elif c["fonte_tese"] in ("ementa", "pedidos"):
            c["corrob"] = True                                   # fonte direta autoritativa
        elif fonte_direto:                                       # peça/petição — assunto complementa
            c["corrob"] = assunto_corrobora(tese, c["assunto"])
        else:                                                    # assunto/DataJud sozinho
            c["corrob"] = False
            c["so_datajud_risco"] = True

    # Uma empresa NÃO ajuíza a MESMA tese duas vezes (regra do escritório). Se
    # dois processos caíram na mesma tese, no máximo um está certo: mantém o de
    # melhor evidência (corroborado > petição lida) e rebaixa os outros a
    # SUGESTÃO, pra revisão manual — em vez de cravar duplicata errada.
    for tese_nome in {c["tese"] for c in candidatos if c.get("tese")}:
        mesmos = [c for c in candidatos if c.get("tese") == tese_nome]
        if len(mesmos) < 2:
            continue
        mesmos.sort(key=lambda c: (bool(c.get("corrob")), bool(c.get("peticao"))), reverse=True)
        for c in mesmos[1:]:
            c["corrob"] = False
            c["dup"] = True
        print(f"  [dup] {len(mesmos)} processos caíram em '{tese_nome.strip()[:48]}' — "
              f"mantido {mesmos[0]['proc']}, os demais viram sugestão.", flush=True)

    analisar(candidatos, motivos, catalogo, razao, cnpj_fmt, len(todos), True)

    # persiste no CRM SÓ o que é de fato tributário (tese cravada OU assunto
    # tributário) — candidato cujo assunto CNJ não é tributário (ex: "Abuso de
    # Poder") não entra na tabela de processos TRIBUTÁRIOS.
    persistir = [c for c in candidatos
                 if (c.get("tese") or assunto_tributario(c.get("assunto") or ""))
                 and not objeto_administrativo(c.get("assunto") or "")]
    if gravar and candidatos:
        if not empresa_id:
            print("  [gravar] empresa não está no CRM (sem empresa_id) — nada gravado.")
        elif not persistir:
            print("  [gravar] nenhum processo tributário (os candidatos não são teses "
                  "pelo assunto CNJ) — nada gravado.")
        else:
            # ANTI-REGRESSÃO: uma tese JÁ CRAVADA (acao_id no CRM) não pode ser
            # rebaixada por evidência FRACA de hoje — se os autos não abriram (limite
            # diário do TRF5), a leitura de hoje não é prova de erro, é ausência de
            # prova. Só rebaixa quando HOUVE leitura assertiva (ementa/petição, mesmo
            # do cache) e ela não confirmou. Busca o estado atual p/ comparar.
            atual = {}
            try:
                inl = ",".join('"' + c["proc"] + '"' for c in persistir)
                for row in sb(f"empresa_processos_tributarios?select=numero,acao_id"
                              f"&empresa_id=eq.{empresa_id}&numero=in.({inl})"):
                    atual[row["numero"]] = row.get("acao_id")
            except Exception:
                atual = {}
            body, mantidos = [], 0
            for c in persistir:
                # leu de fato hoje? (senteça/ementa não-vazia OU petição válida — o
                # cache conta: é fonte assertiva já lida). Se não, autos bloqueados.
                leu_hoje = bool((c.get("sentenca") or "").strip()) or peticao_valida(c.get("peticao") or "")
                novo = (TESE_ID.get(_norm(c["tese"])) if (c.get("tese") and c.get("corrob")) else None)
                prev = atual.get(c["proc"])
                md = {}
                if novo is None and prev and not leu_hoje:
                    # tinha crava e hoje NÃO confirmaria — mas os autos não abriram:
                    # PRESERVA a crava anterior (verificada em sessão passada).
                    novo = prev
                    md = {"motivo": "mantido_autos_bloqueados"}
                    mantidos += 1
                elif c.get("tese") and novo is None:
                    md = {"tese_sugerida": c["tese"], "conf": c.get("conf"),
                          "motivo_sugerida": ("refutado_fonte_direta" if leu_hoje else "autos_bloqueados")}
                body.append({
                    "empresa_id": empresa_id, "numero": c["proc"], "grau": c["grau"],
                    "classe": c.get("classe"), "orgao": c.get("orgao"),
                    "situacao": c.get("situacao"), "polo": "ativo",
                    "assunto": c.get("assunto") or None,
                    "acao_id": novo,          # NUNCA vem só do assunto (corrob exige fonte direta)
                    "metadados": md,
                    "fonte": "pje_tjrn+datajud",
                })
            try:
                sb_upsert("empresa_processos_tributarios", body, "empresa_id,numero")
                extra = (f" ({mantidos} crava(s) preservada(s) — autos bloqueados hoje)"
                         if mantidos else "")
                print(f"  [gravar] {len(body)} processo(s) tributário(s) gravado(s) no CRM.{extra}")
            except Exception as e:
                print(f"  [gravar] falha: {e}")


def _total_encontrado(page):
    """Quantos resultados o PJe DIZ que existem (pode ser > que os exibidos)."""
    try:
        t = page.evaluate("() => (document.body ? document.body.innerText : '')") or ""
    except Exception:
        return None
    m = re.search(r"Foram encontrados:\s*(\d+)", t.replace("\n", " "), re.I)
    return int(m.group(1)) if m else None


def _proxima_pagina(page):
    """Avança a página da LISTA de resultados. True se avançou.

    O paginador do PJe 1.x NÃO é um datascroller de links — é um RichFaces
    **inputNumberSlider**. No texto ele aparece como "Foram encontrados: 51
    resultados  1  4" (página atual e última), e os números são só RÓTULOS:
    clicar neles não faz nada, e o input da página é `readonly`. A virada se faz
    por JS — remover o readonly, setar o valor e disparar os eventos.

    Sem virar, empresa com muitos processos era lida só na 1ª página. E o viés é
    perverso: execução fiscal (onde ela é RÉ) é recente e ocupa a 1ª página,
    enquanto a tese que ela ajuizou é antiga e cai nas seguintes.
    """
    try:
        return bool(page.evaluate(r"""() => {
          const inp = document.querySelector("input[class*='inslider-field']");
          if (!inp) return false;
          const maxEl = document.querySelector('.rich-inslider-right-num');
          const max = maxEl ? parseInt(maxEl.innerText.trim(), 10) : NaN;
          const atual = parseInt(inp.value, 10);
          if (!isFinite(max) || !isFinite(atual) || atual >= max) return false;
          inp.removeAttribute('readonly');
          inp.value = String(atual + 1);
          for (const ev of ['input', 'change', 'keyup', 'blur'])
            inp.dispatchEvent(new Event(ev, {bubbles: true}));
          return true;
        }"""))
    except Exception:
        return False


def _campo_cnpj_1x(page):
    """Campo de CNPJ no PJe 1.x — Terceiros (consultaProcessoTerceirosListCNPJ)
    ou a consulta do advogado (cpfCpnjCNPJ). Reconsultado após cada AJAX."""
    for sel in ("input[id$=':consultaProcessoTerceirosListCNPJ']",
                "input[id*='consultaProcessoTerceirosListCNPJ']",
                "input[id$=':cpfCpnjCNPJ']",
                "input[id*='cpfCpnjCNPJ']"):
        el = page.query_selector(sel)
        if el:
            return el
    return None


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
        page.click("input[value='Pesquisar'], input[id$=':searchButton'], "
                   "button:has-text('Pesquisar')")
        _esperar(page)
        return "doc"
    # PJe 1.x (instância da Seção Judiciária): o CNPJ tem campo PRÓPRIO
    # (consultarProcessoForm:cpfCpnjRadioCPFCNPJ:cpfCpnjCNPJ), não o documentoParte
    # do 2.x. Sem isto caía no fallback por razão social e voltava 0 linhas.
    # 1.x: consulta de TERCEIROS (campo próprio) ou a consulta do advogado (legado)
    doc1x = _campo_cnpj_1x(page)
    if doc1x:
        # LIMPA só SE já houver resultados na tela (o 1.x não zera a tabela entre
        # buscas). Numa página recém-carregada o clear é nocivo: ele re-renderiza
        # o form e reseta o seletor CPF/CNPJ, e a busca sai SEM FILTRO.
        tem_resultado = page.evaluate(
            r"""() => [...document.querySelectorAll('table tr')]
                 .some(tr => !tr.querySelector('tr') &&
                       /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(tr.innerText))"""
        )
        lim = page.query_selector("input[id$=':clearButton']") if tem_resultado else None
        if lim:
            try:
                lim.click()
                page.wait_for_timeout(2500)
            except Exception:
                pass
            # o clear re-renderiza o form via AJAX -> RE-OBTÉM o campo com a
            # MESMA lista de seletores. Com a lista antiga aqui, o handle ficava
            # obsoleto (elemento destacado): o fill não surtia efeito e a busca
            # rodava SEM FILTRO — voltava o banco inteiro (219 mil resultados).
            doc1x = _campo_cnpj_1x(page) or doc1x
        doc1x.fill(cnpj_fmt)
        page.wait_for_timeout(300)
        page.click("input[value='Pesquisar'], input[id$=':searchButton'], "
                   "button:has-text('Pesquisar')")
        _esperar(page, exige_contador=True)
        return "doc"
    nome = page.query_selector("input[id$=':nomeParte']") or page.query_selector("input[id*='nomeParte']")
    if nome and razao:
        nome.fill(razao)
        page.click("input[value='Pesquisar'], input[id$=':searchButton'], "
                   "button:has-text('Pesquisar')")
        _esperar(page)
        return "nome"
    return "?"


def _esperar(page, timeout_s=90, exige_contador=False):
    """Espera o RESULTADO da busca. Antes olhava só o overlay [id$='status.start']
    (padrão do 2.x): no PJe 1.x ele não está visível no instante do poll, então
    saía em ~1,2s — mas o 1.x leva ~30s pra responder, e a busca voltava vazia.
    Agora encerra quando: aparecem linhas de processo, OU há mensagem de vazio,
    OU ficou sem overlay por vários ciclos seguidos (aí é 0 resultado mesmo)."""
    page.wait_for_timeout(800)
    estavel = 0
    ultimo_n, estaveis_n = -1, 0
    for _ in range(int(timeout_s / 1.5)):
        page.wait_for_timeout(1500)
        st = page.evaluate(r"""() => {
          const visivel = e => !!e && getComputedStyle(e).display !== 'none'
                            && getComputedStyle(e).visibility !== 'hidden';
          // 2.x: overlay a4j [id$='status.start'] | 1.x: showLoading() (id/classe 'loading')
          const ov = document.querySelector('[id$="status.start"]');
          const load = [...document.querySelectorAll(
              '[id*="loading"],[class*="loading"],[id*="Loading"],[class*="Loading"]')].some(visivel);
          const t = document.body ? document.body.innerText : '';
          const n = [...document.querySelectorAll('table tr')]
            .filter(tr => /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(tr.innerText)).length;
          // o PJe informa quantos resultados existem — é o alvo exato a renderizar
          const cm = t.replace(/\s+/g,' ').match(/Foram encontrados:\s*(\d+)\s*resultados?/i);
          return {carregando: visivel(ov) || load, n,
                  esperado: cm ? parseInt(cm[1], 10) : null,
                  vazio: /nenhum registro|não foram encontrados/i.test(t)};
        }""")
        if st["vazio"]:
            break
        # quando o PJe diz o total, espera renderizar TODAS as linhas (a tabela
        # monta aos poucos; sair na 1ª perdia processos e os ícones de detalhe).
        esperado = st.get("esperado")
        if esperado is not None:
            # ATENÇÃO ao 0: "Foram encontrados: 0 resultados" é resposta COMPLETA.
            # Com `if esperado:` o zero caía no ramo de espera e o loop rodava o
            # timeout inteiro — 90s parados em CADA empresa sem processo, que é a
            # maioria. Era a principal fonte de lentidão da varredura.
            if esperado == 0:
                break
            if st["n"] >= esperado:
                # Chegou ao total, mas as CÉLULAS ainda podem estar montando (os
                # ícones "Ver Detalhes" chegam por último). Sair aqui lia o polo
                # pela metade e a empresa AUTORA virava "ré": a mesma busca de
                # Três Corações deu 0 candidato num ciclo e 1 no seguinte.
                # Confirma estabilidade antes de seguir.
                if not st["carregando"]:
                    estaveis_n += 1
                    if estaveis_n >= 2:
                        break
                else:
                    estaveis_n = 0
                continue
            # PAGINAÇÃO: a lista mostra no máximo ~15 linhas por página. Se o
            # contador é MAIOR e o número de linhas parou de crescer, a página
            # está completa — o resto está nas próximas. Sem isto o loop ficava
            # esperando o total inteiro renderizar numa página só e estourava o
            # timeout: medido 108s em Guararapes e M. Dias Branco.
            if st["n"] and st["n"] == ultimo_n and not st["carregando"]:
                estaveis_n += 1
                if estaveis_n >= 3:
                    break
            else:
                ultimo_n, estaveis_n = st["n"], 0
            estavel = 0
            continue
        if exige_contador:
            # PJe 1.x: o overlay NÃO é detectável e a tabela mantém uma linha
            # "fantasma" antes do resultado (medido: 16s com n=1 e sem contador).
            # Só o contador "Foram encontrados: N" marca o fim de verdade.
            continue
        if st["n"]:
            # NÃO sair na 1ª linha: a tabela renderiza aos poucos e os ícones
            # ("Ver Detalhes", com a URL do processo) chegam por último. Só segue
            # quando a contagem se repete — aí a lista está completa.
            if st["n"] == ultimo_n and not st["carregando"]:
                estaveis_n += 1
                if estaveis_n >= 3:          # ~4,5s parado E sem overlay
                    break
            else:
                ultimo_n, estaveis_n = st["n"], 0
            continue
        # O 1.x responde em ~20-30s. Só conclui "0 resultado" após ~30s sem
        # nenhum indício de carregamento — antes disso ainda pode estar buscando.
        estavel = 0 if st["carregando"] else estavel + 1
        if estavel >= 20:
            break
    page.wait_for_timeout(500)


# Órgãos julgadores que denunciam matéria FAZENDÁRIA/tributária (sinal grátis
# na lista — complementa a classe, que às vezes é genérica "Procedimento Comum").
ORGAO_FAZENDA = ["FAZENDA", "EXECUCOES FISCAIS", "EXECUCAO FISCAL", "FAZENDARIA", "TRIBUTAR"]


def _col(cells, i):
    return cells[i] if i < len(cells) else ""


_SUFIXOS_GENERICOS = {"LTDA", "ME", "EPP", "EIRELI", "SA", "S/A", "CIA", "COMPANHIA",
                      "SPE", "DO", "DA", "DE", "DOS", "DAS", "E"}


def _tok_limpo(t):
    """Token sem pontuação — 'S.A.' e 'S/A' viram 'SA'."""
    return re.sub(r"[^A-Z0-9]", "", t or "")


def _empresa_polo(razao, ativo, passivo):
    """Em qual polo a empresa está. Casa por TOKENS (todos presentes), não por
    substring contígua: a chave contígua quebrava em nomes com palavras curtas
    — 'DOIS A ENGENHARIA E TECNOLOGIA' virava 'DOIS ENGENHARIA TECNOLOGIA',
    que não existe no texto, e a empresa AUTORA era descartada como ré.

    A limpeza dos tokens é feita SEM PONTUAÇÃO: o conjunto de sufixos tinha 'SA'
    e 'S/A' mas não 'S.A.', então esse token sobrevivia e — como o casamento
    exige TODOS os tokens — nunca casava contra um polo escrito 'S/A'. Resultado:
    toda empresa com 'S.A.' no nome era lida como '?' e descartada, justamente o
    segmento de empresa grande. Foi o caso da Três Corações."""
    toks = [t for t in _norm(razao).split()
            if len(_tok_limpo(t)) > 2 and _tok_limpo(t) not in _SUFIXOS_GENERICOS][:4]
    if not toks:
        return "?"

    # O polo vem TRUNCADO na lista do PJe ("M DIAS BRANCO SA INDUSTRIA" corta
    # antes de "COMERCIO"), então exigir os 4 tokens perdia a empresa. Com 3+
    # tokens, tolera UMA ausência — os 2 primeiros já são bem distintivos, e
    # continuar exigindo todos os presentes evita casar empresa parecida.
    minimo = len(toks) if len(toks) <= 2 else len(toks) - 1
    # ...mas os DOIS PRIMEIROS tokens são obrigatórios: é neles que mora a marca.
    # Sem isso a folga casava "TRES CORACOES ALIMENTOS" com "TRES RIOS COMERCIO
    # DE ALIMENTOS" — as palavras genéricas do ramo bastavam.
    essenciais = toks[:2]

    def bate(txt):
        t = _norm(txt)
        if not all(tok in t for tok in essenciais):
            return False
        return sum(1 for tok in toks if tok in t) >= minimo

    if bate(ativo):
        return "ativo"
    if bate(passivo):
        return "passivo"
    return "?"


POLO_ATIVO_ROT = ("AUTOR", "IMPETRANTE", "EXEQUENTE", "REQUERENTE", "RECLAMANTE",
                  "EMBARGANTE", "AGRAVANTE", "APELANTE")
POLO_PASSIVO_ROT = ("REU", "IMPETRADO", "EXECUTADO", "REQUERIDO", "RECLAMADO",
                    "EMBARGADO", "AGRAVADO", "APELADO", "INTERESSADO")


def _linha_campos(cells, razao):
    """(polo, classe, orgao, situacao) tolerante ao LAYOUT.
    PJe 2.x: colunas fixas (3=órgão, 5=classe, 6=ativo, 7=passivo, 8=situação).
    PJe 1.x: não tem essas colunas — a linha traz os polos ROTULADOS
    ('IMPETRANTE Fulano' / 'IMPETRADO Ministério...') e a classe junto do número.
    Sem isto, todo processo do 1.x caía como polo '?' e era descartado como ré."""
    # 1º: polos ROTULADOS na célula ("AUTOR: X" / "RÉU: Y") — é o layout da
    # consulta de TERCEIROS. Tem prioridade sobre índice fixo porque ali a
    # coluna 6 é o polo PASSIVO: pelo índice, uma empresa RÉ virava "autora".
    rotulado = any(
        any(_norm(c).startswith(m) for m in POLO_ATIVO_ROT + POLO_PASSIVO_ROT)
        for c in cells if c
    )
    classe, orgao, situacao = _col(cells, 5), _col(cells, 3), _col(cells, 8)
    if not rotulado:
        polo = _empresa_polo(razao, _col(cells, 6), _col(cells, 7))
        if polo != "?":
            return polo, classe, orgao, situacao      # layout 2.x: inalterado
    else:
        classe = orgao = situacao = ""                 # recalcula pelo conteúdo
    ativo = passivo = ""
    for c in cells:
        cn = _norm(c)
        if not cn:
            continue
        if not ativo and any(cn.startswith(m) for m in POLO_ATIVO_ROT):
            ativo = c
        elif not passivo and any(cn.startswith(m) for m in POLO_PASSIVO_ROT):
            passivo = c
        if not classe and any(k in cn for k in CLASSES_TESE + CLASSES_SEM_VALOR):
            m = RE_PROC.search(c)                      # classe vem antes do número
            classe = (c[:m.start()] if m else c).strip()
        if not orgao and any(k in cn for k in ("VARA", "TURMA", "JUIZADO", "GABINETE")):
            orgao = c
    return _empresa_polo(razao, ativo, passivo), classe, orgao, situacao


def _eh_candidato(cells, razao):
    """True se a linha é candidata a tese: empresa AUTORA + classe de tese +
    não é embargos/execução/cumprimento. (mesma regra do filtrar_teses, por linha)"""
    polo, classe, _o, _s = _linha_campos(cells, razao)
    cn = _norm(classe)
    if polo != "ativo":
        return False
    if any(k in cn for k in CLASSES_SEM_VALOR):
        return False
    return any(k in cn for k in CLASSES_TESE)


def _ate(pg, js, timeout_s=20, diferente_de=None, passo_ms=500):
    """Espera CONDICIONAL: roda `js` a cada passo até virar verdadeiro (ou mudar,
    quando `diferente_de` é dado). Substitui sleeps fixos — o PJe costuma
    responder em 1-3s, e esperar 6-8s "por garantia" era o que fazia a varredura
    parecer travada. Retorna o último valor."""
    v = None
    for _ in range(int(timeout_s * 1000 / passo_ms)):
        try:
            v = pg.evaluate(js)
        except Exception:
            v = None
        if diferente_de is None:
            if v:
                return v
        elif v and v != diferente_de:
            return v
        pg.wait_for_timeout(passo_ms)
    return v


MOTIVO_CONSULTA = os.environ.get("PJE_MOTIVO_CONSULTA",
                                 "Analise de teses tributarias do cliente")


def _abrir_detalhe_terceiros(page, ctx, proc, tentativas=3):
    """Abre o DETALHE a partir da lista de Terceiros do 1.x. O link é um postback
    A4J (não tem URL) e o PJe exige informar o MOTIVO da consulta num modal —
    a textarea precisa de CLIQUE antes de digitar (fill direto não funciona).
    Retorna a página de detalhe (aba nova) ou None.

    RETRY (25/07): a abertura é FLAKY em runs longos — o `expect_page` às vezes
    perde a aba nova, o modal de motivo não renderiza a tempo, ou abre-se uma aba
    que não é o detalhe esperado. Isso gerava `falhou`/`id_trf` vazio (sem ementa)
    para processos cujos autos abrem NORMALMENTE (confirmado ao vivo). Re-tenta
    algumas vezes, validando que veio o `idProcessoTrf`, e limpa abas órfãs entre
    as tentativas (o acúmulo de abas era parte da causa)."""
    for _try in range(max(1, tentativas)):
        idx = page.evaluate(r"""(proc) => {
          const todos = [...document.querySelectorAll('a')];
          for (const tr of document.querySelectorAll('tr')) {
            if (tr.querySelector('tr') || !tr.innerText.includes(proc)) continue;
            const a = [...tr.querySelectorAll('a')]
              .find(x => /A4J|jsfcljs/.test(x.getAttribute('onclick') || ''));
            if (a) return todos.indexOf(a);
          }
          return -1;
        }""", proc)
        if idx is None or idx < 0:
            return None                     # proc não está na lista — re-tentar não ajuda
        det = None
        try:
            with ctx.expect_page(timeout=45000) as pinfo:
                page.query_selector_all("a")[idx].click()
                page.wait_for_timeout(4000)
                # modal de motivo (pode não aparecer se já consultado nesta sessão)
                alvo = page.evaluate(
                    """() => [...document.querySelectorAll('textarea')]
                         .findIndex(e => /motivacao/i.test(e.id) && e.offsetParent !== null)"""
                )
                if alvo is not None and alvo >= 0:
                    h = page.query_selector_all("textarea")[alvo]
                    h.click()                               # sem o clique não digita
                    page.keyboard.type(MOTIVO_CONSULTA, delay=25)
                    b = page.evaluate(
                        """() => [...document.querySelectorAll('input[type=button]')]
                             .findIndex(e => /gravar/i.test(e.value || '') && e.offsetParent !== null)"""
                    )
                    if b is not None and b >= 0:
                        page.query_selector_all("input[type=button]")[b].click()
            det = pinfo.value
            det.wait_for_load_state("domcontentloaded")
            det.wait_for_timeout(3500)
            # só aceita se abriu o DETALHE de verdade (tem idProcessoTrf); senão re-tenta
            if re.search(r"idProcessoTrf=(\d+)", det.url or ""):
                return det
        except Exception:
            pass
        # tentativa falhou: fecha a aba errada e órfãs, espera e re-tenta
        try:
            if det is not None:
                det.close()
        except Exception:
            pass
        for pg in list(ctx.pages):
            if pg is not page:
                try: pg.close()
                except Exception: pass
        page.wait_for_timeout(1500)
    return None


# Anexos que acompanham TODA inicial — se o texto extraído começa com um destes,
# pegamos o binário errado. Foi o que aconteceu na P J: procuração em 3 processos,
# parecer COSIT em 2, cartão CNPJ em 1. Como o COSIT fala de COFINS, a tese até
# "acertava" — por acidente. Um anexo NUNCA pode ser tratado como o objeto da ação.
_ANEXO_MARCAS = (
    "PROCURACAO", "SUBSTABELECIMENTO", "CONTRATO SOCIAL", "ALTERACAO CONTRATUAL",
    "COMPROVANTE DE INSCRICAO", "CARTAO CNPJ", "SOLUCAO DE CONSULTA",
    "PARECER NORMATIVO", "GUIA DE RECOLHIMENTO", "CUSTAS", "DOCUMENTO DE IDENTIFICACAO",
    "CARTEIRA DE IDENTIDADE", "COMPROVANTE DE ENDERECO", "ATA DE ASSEMBLEIA",
    # atos normativos anexados como prova costumam ser LONGOS e citar tributos —
    # a IN RFB 1300 (59 páginas) passou pela versão anterior desta trava.
    "INSTRUCAO NORMATIVA", "MEDIDA PROVISORIA", "ATO DECLARATORIO", "PORTARIA",
    "RESOLUCAO", "VISAO MULTIVIGENTE", "NORMAS.RECEITA.FAZENDA",
)
# ENDEREÇAMENTO — toda petição inicial abre com ele. É a marca mais confiável:
# as 3 iniciais reais da P J começam com "JUÍZO FEDERAL DE UMA DAS VARAS DA SEÇÃO
# JUDICIÁRIA DO RN". Anexo nenhum tem isso.
_PETICAO_MARCAS = (
    "EXCELENTISSIM", "MERITISSIM", "JUIZO FEDERAL", "JUIZ FEDERAL", "VARA FEDERAL",
    "SECAO JUDICIARIA", "VARA CIVEL", "VARA DA FAZENDA", "COMARCA DE",
    "DESEMBARGADOR", "TRIBUNAL REGIONAL FEDERAL",
)


def peticao_valida(texto):
    """O texto extraído é MESMO a peça inicial (e não um anexo)?

    Porta de qualidade: sem isso o classificador lê procuração/parecer/IN e crava
    tese com 'fonte: petição', dando falsa precisão exatamente onde se pediu
    precisão. Exige o ENDEREÇAMENTO no começo — não basta citar tributo.
    """
    t = _norm(texto or "")
    if len(t) < 400:
        return False
    cabeca = t[:3000]
    if any(m in cabeca[:900] for m in _ANEXO_MARCAS):
        return False
    return any(m in cabeca for m in _PETICAO_MARCAS)


def _peticao_pdf_1x(ctx, base, id_processo):
    """PJe 1.x: TEXTO COMPLETO da petição inicial (PDF), via Paginador.

    Receita descoberta ao vivo (a inicial não aparece nos 15 docs da tela de
    detalhe e o documentoHTML só diz "Em PDF."):
      1. abre  /pje/Processo/Paginador/paginator.seam?idProcesso=N
      2. selecionarFimPaginador()  -> vai ao documento MAIS ANTIGO = a inicial
      3. na lista de binários, escolhe a PEÇA — ver `_ordenar_binarios`.
      4. clicar dispara POST -> 302 -> GET download.seam (application/pdf).
         O body NÃO pode ser lido do evento (o visualizador consome o recurso),
         então captura-se a URL e RE-BUSCA com a sessão do navegador.
    Retorna o texto extraído (pypdf) ou "".
    """
    pg = None
    try:
        pg = ctx.new_page()
        urls = []
        pg.on("response", lambda r: urls.append(
            (r.headers.get("content-type", "") or "", r.url)))
        pg.goto(f"{base}/pje/Processo/Paginador/paginator.seam?idProcesso={id_processo}"
                "&acessoProcessoTerceiros=", wait_until="domcontentloaded", timeout=90000)
        tipo_doc = """() => {
          const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
          return (t.match(/Tipo de Documento:\\s*([^]{0,45}?)\\s+Documento:/i)||[])[1]||'';
        }"""
        # ESPERA CONDICIONAL em vez de sleep fixo: sai assim que o documento
        # aparece/troca. Antes eram 6s + 8s + 6x6s fixos (~50s por peça) mesmo
        # quando a página já tinha respondido em 1-2s.
        _ate(pg, tipo_doc, 25)
        anterior = pg.evaluate(tipo_doc) or ""
        pg.evaluate("() => { if (typeof selecionarFimPaginador === 'function') selecionarFimPaginador(); }")
        _ate(pg, tipo_doc, 25, diferente_de=anterior)
        # o fim NEM SEMPRE é a inicial (ela costuma estar na penúltima página —
        # o último doc pode ser um anexo juntado na autuação). Volta até achar.
        for _ in range(6):
            atual = pg.evaluate(tipo_doc) or ""
            if "eti" in atual:                            # Petição
                break
            pg.evaluate("() => { if (typeof voltarPaginador === 'function') voltarPaginador(); }")
            novo = _ate(pg, tipo_doc, 20, diferente_de=atual)
            # Se o tipo NÃO mudou, o paginador não está respondendo — insistir
            # custa 20s por tentativa e não muda nada. Era daí que vinham os
            # ~167s das peças que não abrem (6 x 20s de espera vazia).
            if novo == atual:
                break
        # RANQUEIA os binários em vez de chutar um. A regra antiga ("a peça é a que
        # NÃO se chama 'Doc. NN -'") pegava justamente os ANEXOS: na P J vieram 3
        # procurações, 2 pareceres da Receita e 1 cartão CNPJ — nenhuma inicial.
        cands = pg.evaluate(r"""() => {
          const out = [];
          [...document.querySelectorAll('a')].forEach((a, i) => {
            if (!/jsfcljs/.test(a.getAttribute('onclick') || '')) return;
            const tr = a.closest('tr'); if (!tr) return;
            const t = tr.innerText.replace(/\s+/g, ' ').trim();
            if (!/\d{2}\/\d{2}\/\d{4}/.test(t)) return;
            let peso = 0;
            if (/inicial/i.test(t)) peso += 10;            // "Petição Inicial"
            if (/peti[çc][ãa]o/i.test(t)) peso += 6;
            // anexos clássicos da inicial — despriorizados, não excluídos
            if (/procura[çc][ãa]o|substabelecimento|contrato social|comprovante|cart[ãa]o|identifica[çc][ãa]o|custas|guia|parecer|consulta/i.test(t))
              peso -= 8;
            if (/Doc\.\s*\d+\s*-/i.test(t)) peso -= 3;
            out.push({i, peso, txt: t.slice(0, 90)});
          });
          return out.sort((a, b) => b.peso - a.peso).slice(0, 5);
        }""") or []
        # NÃO baixar o que o ranking já reconheceu como anexo: cada tentativa é um
        # clique + espera do PDF + parse (~30s). Medido 163s numa peça só porque
        # procuração e contrato social entravam na fila de tentativas. Se nada tem
        # peso positivo, tenta os 2 melhores mesmo assim (rótulo pode estar vazio).
        positivos = [c for c in cands if c.get("peso", 0) > 0]
        cands = positivos[:3] if positivos else cands[:2]
        if not cands:
            return ""
        import io as _io
        import pypdf
        for c in cands:
            urls.clear()
            try:
                pg.query_selector_all("a")[c["i"]].click()
            except Exception:
                continue
            # espera o PDF chegar (em vez de 7s fixos) — costuma vir em 1-3s
            for _ in range(30):
                if any("application/pdf" in ct for ct, _u in urls):
                    break
                pg.wait_for_timeout(500)
            alvo = next((u for ct, u in urls if "application/pdf" in ct), None)
            if not alvo:
                continue
            try:
                data = pg.request.get(alvo, timeout=60000).body()
                if data[:4] != b"%PDF":
                    continue
                rd = pypdf.PdfReader(_io.BytesIO(data))
                txt = "\n".join((x.extract_text() or "") for x in rd.pages[:8])
            except Exception:
                continue
            if peticao_valida(txt):
                return txt
            if len(txt) > len(melhor):
                melhor = txt
        # nenhum candidato passou na trava: devolve vazio em vez do maior anexo —
        # classificar por anexo é pior que não classificar (dá falsa precisão).
        return ""
    except Exception:
        return ""
    finally:
        if pg is not None:
            try: pg.close()
            except Exception: pass


_SENT_TIPO = re.compile(r"senten[çc]a|ac[óo]rd[ãa]o|decis[ãa]o de m[ée]rito|ementa", re.I)


# ---------------------------------------------------------------------------
# DETECTOR DE ESGOTAMENTO DE AUTOS — OPT-IN (default DESLIGADO). A hipótese de um
# "limite diário do TRF5" se mostrou FALSA (25/07): os autos continuam abrindo
# manualmente; as leituras vazias em lote eram FLAKINESS do _abrir_detalhe_terceiros
# num run longo, não bloqueio do servidor. Um detector que desiste amplifica a
# flakiness (para de ler quando bastava re-tentar). Por isso fica DESLIGADO por
# padrão; só liga com AUTOS_LIMITE>0 no ambiente, se algum dia houver limite real.
# ---------------------------------------------------------------------------
_AUTOS_VAZIOS = 0
_AUTOS_LIMITE = int(os.environ.get("AUTOS_LIMITE", "0") or "0")   # 0 = desligado
_AUTOS_ESGOTADO = False


def _autos_esgotado():
    return _AUTOS_LIMITE > 0 and _AUTOS_ESGOTADO


def _registrar_autos(ok):
    """Só atua se AUTOS_LIMITE>0. ok=True reseta; vazio soma; ao cruzar o limite,
    sinaliza esgotado e o _sentenca_pdf_1x passa a curto-circuitar."""
    global _AUTOS_VAZIOS, _AUTOS_ESGOTADO
    if _AUTOS_LIMITE <= 0:
        return
    if ok:
        _AUTOS_VAZIOS = 0
        return
    _AUTOS_VAZIOS += 1
    if _AUTOS_VAZIOS >= _AUTOS_LIMITE and not _AUTOS_ESGOTADO:
        _AUTOS_ESGOTADO = True
        print(f"  [autos] {_AUTOS_LIMITE} leituras vazias seguidas (AUTOS_LIMITE ligado) "
              f"— parando de abrir autos nesta sessão.", flush=True)


def _sentenca_pdf_1x(ctx, base, id_processo):
    """PJe 1.x: texto da SENTENÇA/ACÓRDÃO via Paginador, achando o doc pelo TIPO
    CADASTRADO ('Sentença'/'Acórdão'/'Decisão') — não há lista de links sob acesso
    de terceiros, então NAVEGA checando o 'Tipo de Documento:' de cada peça (como
    o leitor da inicial). A ementa do julgado é o OBJETO autoritativo da tese."""
    if _autos_esgotado():        # limite diário do TRF5 já detectado nesta sessão
        return ""
    pg = None
    try:
        pg = ctx.new_page()
        urls = []
        pg.on("response", lambda r: urls.append((r.headers.get("content-type", "") or "", r.url)))
        pg.goto(f"{base}/pje/Processo/Paginador/paginator.seam?idProcesso={id_processo}"
                "&acessoProcessoTerceiros=", wait_until="domcontentloaded", timeout=90000)
        # Lê TIPO + IDENTIFICADOR do doc corrente. O movimento é detectado pelo
        # IDENTIFICADOR (o tipo se repete — várias "Certidão de Intimação" seguidas
        # enganavam a detecção por tipo, parando a navegação no 2º doc).
        meta_js = """() => {
          const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
          const tipo=(t.match(/Tipo de Documento:\\s*([^]{0,55}?)\\s+(?:Documento|N\\.? do documento|Id|Identificador)/i)||[])[1]||'';
          const ident=(t.match(/Identificador:\\s*([\\d.]+)/i)||[])[1]||'';
          return {tipo, ident};
        }"""
        # normaliza o início no doc MAIS RECENTE (fim = mais ANTIGO); a sentença/
        # acórdão é anterior ao trânsito -> avança rumo ao antigo com adiantarPaginador.
        pg.evaluate("() => { try { if (typeof selecionarInicioPaginador==='function') selecionarInicioPaginador(); } catch(e){} }")
        pg.wait_for_timeout(1200)
        # O julgado (Decisão/Sentença/Acórdão) renderiza como HTML NO BODY do
        # paginador (não é PDF). Navega coletando os julgados de MÉRITO e devolve o
        # melhor — pula decisão de ADMISSIBILIDADE de REsp (não enuncia a tese) e
        # prefere EMENTA (acórdão) > dispositivo ("julgo procedente"/"concedo a
        # segurança"). Percorre até ~55 docs (a sentença de 1º grau é antiga).
        vistos = set()
        julgados = []   # (score, corpo)
        for _ in range(55):
            m = pg.evaluate(meta_js)
            tipo, ident = (m.get("tipo") or ""), (m.get("ident") or "")
            if os.environ.get("DBG_SENTENCA"):
                print(f"      [DBG_SENTENCA {id_processo}] tipo='{tipo[:40]}' id={ident}", flush=True)
            if _SENT_TIPO.search(tipo) and ident and ident not in vistos:
                vistos.add(ident)
                corpo = pg.evaluate("() => document.body ? document.body.innerText : ''") or ""
                score = 0
                if re.search(r"\bEMENTA\b", corpo, re.I): score += 6
                if re.search(r"julg[uo]\b[^.]{0,45}(proced|improced)", corpo, re.I): score += 5
                if re.search(r"concedo[^.]{0,25}seguran|reconhe[çc][^.]{0,30}direito|declar[oa][^.]{0,30}(direito|inexig)", corpo, re.I): score += 4
                if re.search(r"\bDISPOSITIVO\b", corpo, re.I): score += 2
                if re.search(r"admissibilidade|inadmito|admito o recurso|ju[íi]zo de admiss|sobresta", corpo, re.I): score -= 6
                # EMBARGOS DE DECLARAÇÃO e EXTINÇÃO por desistência/sem-mérito NÃO
                # enunciam a tese de mérito — quando há o julgado de mérito junto, ele
                # deve vencer; quando só há isto, melhor devolver vazio (cai na petição,
                # que É a fonte do objeto). Penaliza p/ não gravar embargos/extinção
                # como se fosse o mérito (era ~1/3 das sugeridas "lidas mas não casam").
                if re.search(r"embargos de declara", corpo, re.I): score -= 5
                if re.search(r"sem resolu[çc][ãa]o do?\s*m[ée]rito|homolog[uo][^.]{0,30}(desist|ren[úu]nc)|extin[çc][ãa]o[^.]{0,25}(desist|sem m[ée]rito)|desist[êe]ncia (?:do|da) (?:impetr|autor)", corpo, re.I): score -= 5
                if len(corpo) > 400 and score > 0:
                    if score >= 6:            # acórdão/sentença de mérito claro -> para já
                        return corpo
                    julgados.append((score, corpo))
            if not pg.evaluate("() => { try { if (typeof adiantarPaginador==='function') { adiantarPaginador(); return 1; } return 0; } catch(e){ return -1; } }"):
                break
            moveu = False
            for _ in range(20):
                pg.wait_for_timeout(400)
                if (pg.evaluate(meta_js).get("ident") or "") != ident:
                    moveu = True
                    break
            if not moveu:   # chegou ao fim (mais antigo)
                break
        if julgados:
            julgados.sort(key=lambda x: x[0], reverse=True)
            return julgados[0][1]
        return ""
    except Exception:
        return ""
    finally:
        if pg is not None:
            try: pg.close()
            except Exception: pass


def zona_ementa(texto):
    """Extrai a EMENTA (cabeçalho canônico do julgado). Fica logo após 'EMENTA'
    até 'ACÓRDÃO'/'RELATÓRIO'/'Vistos'. Sem ementa formal (sentença de 1º grau),
    usa o DISPOSITIVO ('julgo procedente ... para') que enuncia o objeto."""
    t = texto or ""
    m = re.search(r"\bEMENTA\b\s*[:\-]?\s*(.{80,2500}?)(?:\bAC[ÓO]RD[ÃA]O\b|\bRELAT[ÓO]RIO\b|\bVISTOS\b|\bA C[ÓO] R D)", t, re.I | re.S)
    if m:
        return m.group(1)
    # EMENTA SEM marcador de fechamento (sentença curta, ex.: ato procedural cuja
    # ementa é "CUMPRIMENTO DE SENTENÇA. HOMOLOGAÇÃO DA EXTINÇÃO. ACOLHIMENTO."):
    # captura da 'EMENTA' até o 1º item numerado ("1.")/quebra dupla/"A parte". Sem
    # isto a zona vinha VAZIA -> classificava a sentença INTEIRA (ruidosa) e o
    # texto do corpo (citações da IN RFB etc.) casava tokens genéricos por acidente.
    m = re.search(r"\bEMENTA\b\s*[:\-]?\s*(.{30,900}?)(?:\n\s*\d{1,2}\s*[.\-)]|\n\s*\n|\bA\s+parte\b|\bTrata-se\b)", t, re.I | re.S)
    if m and len(m.group(1).strip()) >= 30:
        return m.group(1)
    m = re.search(r"(julg[uo][^.]{0,40}proced[^.]{0,900}|conced[oi][^.]{0,40}(?:a\s+)?seguran[çc]a[^.]{0,900}|dou provimento[^.]{0,900})", t, re.I | re.S)
    return m.group(1) if m else ""


def classificar_por_ementa(catalogo_norm, sentenca):
    """(tese, 'ementa') classificando a EMENTA do julgado — sinal AUTORITATIVO,
    pois o juiz enuncia o objeto sem a poluição de precedentes. '' se sem ementa."""
    if not sentenca:
        return None, None
    # acórdão traz EMENTA canônica; sentença de 1º grau não tem ementa formal —
    # aí classifica a peça INTEIRA sem jurisprudência (o dispositivo enuncia a tese).
    z = zona_ementa(sentenca)
    base = z if z else sentenca
    # ATO PROCEDURAL não enuncia a tese de MÉRITO: cumprimento de sentença,
    # habilitação de crédito, homologação de extinção/desistência, execução. Quando
    # a zona_ementa vem vazia e classifica a sentença INTEIRA, esses atos casam
    # tokens genéricos por acidente (ex.: MEGAFRAL 0802506-90 — "habilitação do
    # crédito tributário" + "substituto" incidental => CREDITAMENTO ICMS-ST falso).
    if pedido_procedimental(base):
        return None, None
    tese, _ = classificar_tese("", "", catalogo_norm, strip_jurisprudencia(base))
    return (tese, "ementa") if tese else (None, None)


def _extrair_detalhe_1x(det, ctx, base):
    """De uma página de DETALHE já aberta (1.x): (assunto da fonte, órgão, petição)."""
    meta = det.evaluate(r"""() => {
      const txt = id => { const e=document.querySelector('[id^="'+id+'"]');
                          return e ? e.textContent.replace(/\s+/g,' ').trim() : ''; };
      const t = (document.body?document.body.innerText:'').replace(/\s+/g,' ');
      const m = t.match(/Assunto\s+(DIREITO[^]*?)\s+Foram encontrados/i);
      return {orgao: txt('cabecalhoDadosProcessoActionOrgaoJul'),
              assunto: m ? m[1].trim() : ''};
    }""")
    peticao = ""
    m = re.search(r"idProcessoTrf=(\d+)", det.url or "")
    if m:
        peticao = _peticao_pdf_1x(ctx, base, m.group(1))
    return meta.get("assunto", ""), meta.get("orgao", ""), peticao


def _detalhe_peticao_1x(ctx, base, caminho_detalhe):
    """PJe 1.x: abre a tela de DETALHE do processo direto pela URL (o link é um
    openPopUp — navegar direto evita o bloqueador de pop-up) e retorna
    (assunto, orgao, peticao).

    Vantagem sobre o 2.x: o detalhe traz o ASSUNTO DA FONTE (não precisa do
    DataJud, que engana) e a petição inicial abre como HTML (documentoHTML.seam),
    não PDF — extração confiável e SEM gastar abertura de autos (sem limite diário).
    """
    assunto = orgao = peticao = ""
    det = None
    try:
        det = ctx.new_page()
        det.goto(base + caminho_detalhe, wait_until="domcontentloaded", timeout=60000)
        det.wait_for_timeout(3500)
        meta = det.evaluate(r"""() => {
          const txt = id => { const e=document.querySelector('[id^="'+id+'"]');
                              return e ? e.textContent.replace(/\s+/g,' ').trim() : ''; };
          const t = (document.body?document.body.innerText:'').replace(/\s+/g,' ');
          // "Assuntos ... Assunto <VALOR> Foram encontrados"
          const m = t.match(/Assunto\s+(DIREITO[^]*?)\s+Foram encontrados/i);
          return {orgao: txt('cabecalhoDadosProcessoActionOrgaoJul'),
                  assunto: m ? m[1].trim() : ''};
        }""")
        assunto, orgao = meta.get("assunto", ""), meta.get("orgao", "")
        # A lista traz só os documentos MAIS RECENTES (15) — a petição inicial é a
        # mais antiga e não aparece. Então FILTRA por tipo "Petição Inicial".
        # o select NÃO tem onchange: é preciso APLICAR no botão do próprio painel
        # de documentos (prefixo dinâmico, ex. 'j_id1147:searchButton').
        try:
            sel = det.query_selector("select[id$=':tipoDocumentoFilter']")
            det.select_option("select[id$=':tipoDocumentoFilter']", label="Petição Inicial")
            pref = (sel.get_attribute("id") or "").split(":")[0]
            if pref:
                det.click(f"input[id='{pref}:searchButton']", timeout=8000)
        except Exception:
            pass
        # procura a linha-FOLHA do documento (linha-container tem o dropdown inteiro
        # no innerText e levaria ao doc errado — foi assim que veio uma certidão)
        js_doc = r"""() => {
          for (const a of document.querySelectorAll('a')) {
            const oc = a.getAttribute('onclick') || '';
            const m = oc.match(/'(\/pje\/[^']*documentoHTML[^']*)'/);
            if (!m) continue;
            const tr = a.closest('tr');
            if (!tr || tr.querySelector('tr')) continue;      // só linha-folha
            if (/peti[çc][ãa]o inicial/i.test(tr.innerText.replace(/\s+/g,' '))) return m[1];
          }
          return null;
        }"""
        js_desc = r"""() => {
          for (const a of document.querySelectorAll('a')) {
            const oc = a.getAttribute('onclick') || '';
            if (!/documentoHTML/.test(oc)) continue;
            const tr = a.closest('tr');
            if (!tr || tr.querySelector('tr')) continue;
            const t = tr.innerText.replace(/\s+/g,' ').trim();
            if (/peti[çc][ãa]o inicial/i.test(t)) return t;
          }
          return '';
        }"""
        cam, desc = None, ""
        for _ in range(20):                    # o filtro re-renderiza via AJAX
            det.wait_for_timeout(1500)
            cam = det.evaluate(js_doc)
            if cam:
                desc = det.evaluate(js_desc) or ""
                break
        if cam:
            doc = ctx.new_page()
            try:
                doc.goto(base + cam.replace("&amp;", "&"), wait_until="domcontentloaded", timeout=60000)
                doc.wait_for_timeout(2500)
                peticao = doc.evaluate(
                    "() => (document.body ? document.body.innerText : '')") or ""
            except Exception:
                pass
            finally:
                try: doc.close()
                except Exception: pass
            # Quando a inicial é PDF anexo, o documentoHTML só traz "Em PDF." + o
            # carimbo de assinatura. A DESCRIÇÃO da linha costuma nomear o objeto,
            # então entra junto no texto usado pra classificar.
            if desc and "em pdf" in (peticao or "").lower()[:60]:
                peticao = desc + " " + (peticao or "")
        # Se a inicial é PDF anexo, o texto acima é só o carimbo. Busca a peça
        # COMPLETA pelo Paginador (é o objeto real da tese).
        if len(peticao) < 1200:
            m = re.search(r"idProcessoTrf=(\d+)", caminho_detalhe or "")
            if m:
                corpo = _peticao_pdf_1x(ctx, base, m.group(1))
                if len(corpo) > len(peticao):
                    peticao = corpo
    except Exception:
        pass
    finally:
        if det is not None:
            try: det.close()
            except Exception: pass
    return assunto, orgao, peticao


# ---------------------------------------------------------------------------
# CACHE DE PETIÇÃO — a inicial é IMUTÁVEL (é a peça que abriu o processo), então
# baixar uma vez basta. Sem isso, cada re-análise (toda vez que uma tese nova
# entra no catálogo) refazia o download de TODAS as petições da empresa: era o
# grosso dos 10 minutos por empresa. Com cache, reclassificar fica instantâneo.
# ---------------------------------------------------------------------------
CACHE_DIR = str(ROOT / "tools" / ".cache" / "peticoes")
USAR_CACHE = True
LER_SENTENCA = False  # --ementa: lê a SENTENÇA/ementa como sinal autoritativo do objeto


def _cache_path(proc):
    return os.path.join(CACHE_DIR, re.sub(r"\D", "", proc or "") + ".json")


def _cache_ler(proc):
    if not USAR_CACHE:
        return None
    try:
        with open(_cache_path(proc), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


MAX_TENTATIVAS_PETICAO = 2


def _cache_gravar(proc, assunto, orgao, peticao, id_trf=""):
    """Memoriza o resultado — inclusive a FALHA, com contador de tentativas.

    Cachear vazio de primeira congelaria uma falha transitória (sessão caída,
    PJe lento) como se fosse resultado real; por isso conta as tentativas e só
    desiste na segunda. Sem isso, peça que não abre era rebaixada em TODA
    re-execução: 0800466-45.2013 foi tentada 4x a ~167s — 11 minutos num
    processo só, e era o maior gasto isolado da varredura.

    `id_trf` (idProcessoTrf) é guardado p/ o modo --ementa ler a sentença DIRETO
    do cache, sem re-abrir o detalhe (senão --ementa exigia --sem-cache).
    """
    if not USAR_CACHE:
        return
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        prev = _cache_ler(proc) or {}
        idt = id_trf or prev.get("id_trf", "")     # preserva se não veio agora
        # QUALIDADE (23/07): só cacheia como PETIÇÃO o que é a inicial de fato
        # (peticao_valida) ou um texto substancial (>=2500 chars). Antes o piso era
        # 200 chars — congelava fragmento/cabeçalho como "petição" e o classificador
        # cravava em cima de lixo. Fragmento cai no ramo de FALHA (retryável).
        if peticao_valida(peticao) or len((peticao or "").strip()) >= 2500:
            corpo = {"assunto": assunto, "orgao": orgao, "peticao": peticao, "id_trf": idt}
        else:
            corpo = {"assunto": assunto or prev.get("assunto", ""),
                     "orgao": orgao or prev.get("orgao", ""), "peticao": "", "id_trf": idt,
                     "falhou": True, "tentativas": int(prev.get("tentativas", 0)) + 1}
        with open(_cache_path(proc), "w", encoding="utf-8") as fh:
            json.dump(corpo, fh, ensure_ascii=False)
    except Exception:
        pass


def _cache_sentenca(proc, sentenca):
    """Memoriza a EMENTA/sentença do julgado (imutável) no MESMO arquivo de cache.
    Só grava NÃO-VAZIO: julgado bloqueado pelo limite diário de autos — ou processo
    ainda sem sentença — fica de fora e é RE-TENTADO numa sessão nova (é exatamente
    onde o orçamento de autos deve ser gasto). Com isso, `--ementa` em re-run só
    navega o Paginador do que ainda falta; releitura de julgado confirmado custa ~0
    (era o gargalo: 95% do tempo em leitura de autos, ~40s/peça)."""
    if not USAR_CACHE or not (sentenca or "").strip():
        return
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        prev = _cache_ler(proc) or {}
        prev["sentenca"] = sentenca
        with open(_cache_path(proc), "w", encoding="utf-8") as fh:
            json.dump(prev, fh, ensure_ascii=False)
    except Exception:
        pass


def _cache_utilizavel(cach):
    """O cache responde por si? Sucesso sempre; falha só depois de insistir."""
    if not cach:
        return False
    if cach.get("peticao"):
        return True
    return int(cach.get("tentativas", 0)) >= MAX_TENTATIVAS_PETICAO


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
        polo, classe, orgao, situacao = _linha_campos(cells, razao)
        cn = _norm(classe)
        if polo != "ativo":                          # ré = sem valor
            motivos["re"] += 1; continue
        if any(k in cn for k in CLASSES_SEM_VALOR):   # embargos/execução/cumprimento
            motivos["sem_valor"] += 1; continue
        if not any(k in cn for k in CLASSES_TESE):    # classe não é de tese
            motivos["nao_tese"] += 1; continue
        candidatos.append({"proc": proc, "grau": r["grau"], "classe": classe,
                           "orgao": r.get("orgao_fonte") or orgao, "situacao": situacao,
                           "peticao": r.get("peticao", ""),
                           # a EMENTA do julgado (sinal autoritativo) é lida em r["sentenca"]
                           # por _sentenca_pdf_1x — sem carregá-la aqui, classificar_por_ementa
                           # recebia sempre "" e o modo --ementa nunca cravava (parecia miscalibrado).
                           "sentenca": r.get("sentenca", ""),
                           "assunto_fonte": r.get("assunto_fonte", "")})
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
        if tese and it.get("corrob"):
            # rótulo HONESTO da base: ementa/pedidos cravam por serem autoritativas
            # (o assunto pode NEM corroborar — ex.: DataJud diz "Receitas Transferidas"
            # e a ementa é ISS). Só rotula "assunto CORROBORA" quando de fato corrobora.
            fnt = it.get("fonte_tese", "?")
            if fnt in ("ementa", "pedidos"):
                base_lbl = ("ementa autoritativa" if fnt == "ementa" else "pedidos autoritativos")
                if assunto_corrobora(tese, asn):
                    base_lbl += " + assunto corrobora"
            else:
                base_lbl = "peça + assunto corrobora"
            linha += (f"\n        => TESE: {tese.strip()} (confiança {it.get('conf')}"
                      f", fonte: {fnt}, {base_lbl})")
            teses_ja.setdefault(tese, []).append(it["proc"])
        elif tese:
            if it.get("dup"):
                motivo = "duplicata da mesma tese — mantido o processo de melhor evidência"
            elif it.get("fonte_direto"):
                motivo = "fonte direta não corroborada pelo assunto"
            else:
                motivo = "só assunto (sem fonte direta) — política exige ementa/pedidos/petição"
            linha += (f"\n        => tese SUGERIDA (revisar): {tese.strip()}  "
                      f"[fonte: {it.get('fonte_tese','?')} · {motivo}]")
        elif asn and objeto_administrativo(asn):
            linha += "\n        => objeto administrativo específico (CND/certidão) — NÃO é tese"
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
