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
PJE_1X_2G = "https://pje.trf5.jus.br/pje/Processo/ConsultaProcesso/listView.seam"
# PROTOCOLO PADRÃO de análise de teses (o que roda quando a UI pede): federal
# 2.x (1º e 2º grau) + PJe 1.x da Seção Judiciária da UF da empresa.
PROTOCOLO_PADRAO = "1gf,2gf,1x"
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
    # "não cumulatividade" é regime de PIS/COFINS — é tributário, e sem isto
    # processos assim eram descartados como "não é matéria tributária".
    "NAO CUMULATIVIDADE", "LANCAMENTO", "ISENCAO", "IMUNIDADE", "PRESCRICAO",
    "RAT", "SAT", "GILRAT", "FGTS", "INSS", "TERCO DE FERIAS", "TERCO CONSTITUCIONAL",
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
        ("RESCISÓRIA DO TEMA 985 (TERÇO DE FÉRIAS)",
         {"any": ["TERCO CONSTITUCIONAL", "TERCO DE FERIAS", "ADICIONAL DE FERIAS",
                  "1/3 DE FERIAS", "TEMA 985"], "conf": "alta"}),
        ("REDUÇÃO ALÍQUOTA RAT BASEADO NA ATIVIDADE PREPONDERANTE",
         {"any": ["RAT", "FAP", "GILRAT", "SAT", "RISCOS AMBIENTAIS DO TRABALHO",
                  "ATIVIDADE PREPONDERANTE"], "conf": "alta"}),
        # LIMITAÇÃO A 20 SALÁRIOS MÍNIMOS das contribuições de terceiros/parafiscais
        ("LIMITAÇÃO A 20 SALÁRIOS MÍNIMOS DA BASE DAS CONTRIBUIÇÕES DE TERCEIROS",
         {"any": ["20 SALARIOS MINIMOS", "VINTE SALARIOS MINIMOS", "CONTRIBUICOES PARAFISCAIS",
                  "CONTRIBUICAO PARAFISCAL", "SALARIO EDUCACAO", "INCRA", "SEBRAE",
                  "SENAI", "SENAC", "SESC", "SESI", "SENAT", "APEX", "ABDI"], "conf": "alta"}),
        # CPP/RAT sobre VALORES RETIDOS do segurado (contribuição do empregado + IRRF)
        ("EXCLUSÃO DOS VALORES RETIDOS DO SEGURADO DA BASE DA CPP E DO RAT",
         {"any": ["VALORES RETIDOS", "VALOR RETIDO", "RETIDOS PELA", "RETIDOS A TITULO"],
          "hint": ["CONTRIBUICAO PREVIDENCIARIA", "RAT", "PATRONAL"], "conf": "alta"}),
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
        ("NÃO TRIBUTAÇÃO DOS INCENTIVOS FISCAIS DE ICMS PELO IRPJ, CSLL, PIS E COFINS",
         {"all": ["CREDITO PRESUMIDO"], "any": ["PIS", "COFINS", "NAO CUMULATIVIDADE"], "conf": "alta"}),
        ("NÃO TRIBUTAÇÃO DOS INCENTIVOS FISCAIS DE ICMS PELO IRPJ, CSLL, PIS E COFINS",
         {"any": ["INCENTIVO FISCAL", "INCENTIVOS FISCAIS", "SUBVENCAO", "SUBVENCOES",
                  "BENEFICIO FISCAL", "BENEFICIOS FISCAIS"],
          "hint": ["ICMS"], "conf": "alta"}),
        # teses do PDF que estavam no catálogo mas SEM regra de classificação —
        # por isso caíam em "tributário, fora do catálogo".
        # ICMS-ST: CRÉDITO (substituído aproveita o ST pago pelo substituto) vem
        # ANTES da de exclusão da base — são objetos diferentes.
        ("CREDITAMENTO DE PIS E COFINS SOBRE O ICMS-ST PAGO PELO SUBSTITUTO",
         {"all": ["CREDIT"], "any": ["ICMS-ST", "ICMS ST", "SUBSTITUTO", "SUBSTITUIDO",
                                     "SUBSTITUICAO TRIBUTARIA"], "conf": "alta"}),
        ("EXCLUSÃO DO ICMS-ST DA BASE DE CÁLCULO DO PIS E DA COFINS",
         {"any": ["ICMS-ST", "ICMS ST", "SUBSTITUICAO TRIBUTARIA", "SUBSTITUIDO"],
          "hint": ["PIS", "COFINS"], "conf": "alta"}),
        ("EXCLUSÃO DO ISS DA BASE DE CÁLCULO DO PIS E DA COFINS (TEMA 118)",
         {"all": ["ISS"], "any": ["PIS", "COFINS", "BASE DE CALCULO", "TEMA 118"], "conf": "alta"}),
        ("EXCLUSÃO DA GORJETA DA BASE DE CÁLCULO DO PIS E DA COFINS",
         {"any": ["GORJETA", "GORJETAS"], "conf": "alta"}),
        # PAT — Decreto 10.854/2021 limitou a dedução do Programa de Alimentação
        # do Trabalhador; a tese afasta a limitação.
        ("MANUTENÇÃO DA DEDUÇÃO DO PAT (DECRETO 10.854/2021)",
         {"any": ["PAT", "PROGRAMA DE ALIMENTACAO DO TRABALHADOR", "DECRETO 10.854",
                  "10.854"], "conf": "alta"}),
        # Aprendizes fora da base da CPP/terceiros/RAT
        ("EXCLUSÃO DOS APRENDIZES DA BASE DA CPP, TERCEIROS E RAT",
         {"any": ["APRENDIZ", "APRENDIZES", "MENOR APRENDIZ"], "conf": "alta"}),
        # Tema 69 do STF — ICMS fora da base do PIS/COFINS (a tese mais clássica)
        ("EXCLUSÃO DO ICMS DA BASE DE CÁLCULO DO PIS E DA COFINS (TEMA 69)",
         {"all": ["ICMS"], "any": ["TEMA 69", "EXCLUSAO - ICMS", "FATURAMENTO",
                                   "RECEITA BRUTA"], "hint": ["PIS", "COFINS"], "conf": "alta"}),
        # PIS/COFINS sobre RECEITAS FINANCEIRAS (Decreto 8.426/2015 restabeleceu
        # as alíquotas por decreto). Vem antes da genérica de "própria base".
        ("NÃO INCIDÊNCIA DE PIS E COFINS SOBRE RECEITAS FINANCEIRAS",
         {"any": ["RECEITAS FINANCEIRAS", "RECEITA FINANCEIRA", "DECRETO 8.426",
                  "8.426"], "conf": "alta"}),
        ("NÃO INCIDÊNCIA DA CONTRIBUIÇÃO PATRONAL (CPP) SOBRE VERBAS INDENIZATÓRIAS",
         # o assunto do CNJ usa hífen ("Salário-Maternidade", "Auxílio-Creche") e o
         # casamento é por palavra inteira — precisa das duas grafias.
         {"any": ["VERBAS INDENIZATORIAS", "VERBA INDENIZATORIA", "AVISO PREVIO INDENIZADO",
                  "PRIMEIROS 15 DIAS", "AUXILIO CRECHE", "AUXILIO-CRECHE",
                  "SALARIO MATERNIDADE", "SALARIO-MATERNIDADE",
                  "ABONO PECUNIARIO", "ABONO ASSIDUIDADE"], "conf": "alta"}),
        # crédito presumido de ICMS fora da base do IRPJ/CSLL (sem PIS/COFISN acima)
        ("EXCLUSÃO DA INCIDÊNCIA DO IRPJ E DA CSLL SOBRE OS CRÉDITOS PRESUMIDOS DE ICMS",
         {"all": ["CREDITO PRESUMIDO"], "conf": "alta"}),
        # creditamento PIS/COFINS sobre ICMS na aquisição (exige AQUISICAO p/ não
        # colidir com crédito presumido)
        ("CREDITAMENTO DE PIS E COFINS SOBRE O ICMS NA AQUISIÇÃO DE MERCADORIAS",
         {"all": ["AQUISICAO"], "any": ["PIS", "COFINS"], "hint": ["ICMS", "CREDIT"], "conf": "alta"}),
        # IPI — exclusão do IPI da base do PIS/COFINS (indústria: bebidas, etc.)
        ("EXCLUSÃO DO IPI DA BASE DE CÁLCULO DO PIS E DA COFINS",
         {"any": ["IPI", "IMPOSTO SOBRE PRODUTOS INDUSTRIALIZADOS"], "conf": "alta"}),
        # ICMS "por dentro" — exclusão do ICMS da própria base de cálculo
        ("EXCLUSÃO DO ICMS DA PRÓPRIA BASE DE CÁLCULO (ICMS POR DENTRO)",
         {"all": ["ICMS"], "any": ["POR DENTRO", "PROPRIA BASE", "NA PROPRIA BASE", "NA SUA BASE"],
          "conf": "alta"}),
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
    ("HOSPITA",                    ["HOSPITALAR", "SAUDE", "IRPJ", "CSLL", "LUCRO PRESUMIDO"]),
    ("TERCO",                      ["TERCO", "FERIAS", "SALARIO DE CONTRIBUICAO", "CONTRIBUICAO"]),
    ("RAT",                        ["RAT", "GILRAT", "FAP", "ATIVIDADE PREPONDERANTE", "GRAU DE RISCO",
                                    "ACIDENTE", "CONTRIBUICAO SOBRE A FOLHA"]),
    ("IRRF",                       ["IRRF", "RETIDO", "IMPOSTO DE RENDA"]),
    ("CREDITAMENTO",               ["CREDITO", "AQUISICAO", "NAO CUMULATIVIDADE", "INSUMO"]),
    ("ICMS-ST",                    ["SUBSTITUICAO TRIBUTARIA", "ICMS-ST", "ICMS ST"]),
    ("IPI",                        ["IPI", "PRODUTOS INDUSTRIALIZADOS"]),
    ("POR DENTRO",                 ["ICMS", "POR DENTRO", "BASE DE CALCULO"]),
    ("CREDITOS PRESUMIDOS",        ["CREDITO PRESUMIDO", "INCENTIVO", "INCENTIVOS", "SUBVENCAO",
                                    "SUBVENCOES", "BENEFICIO FISCAL", "BENEFICIOS FISCAIS",
                                    "NAO CUMULATIVIDADE"]),
    ("INCENTIVOS FISCAIS DE ICMS", ["CREDITO PRESUMIDO", "INCENTIVO", "INCENTIVOS", "SUBVENCAO",
                                    "SUBVENCOES", "BENEFICIO FISCAL", "BENEFICIOS FISCAIS",
                                    "NAO CUMULATIVIDADE"]),
    ("20 SALARIOS MINIMOS",        ["INCRA", "SEBRAE", "SENAI", "SENAC", "SESC", "SESI",
                                    "SALARIO EDUCACAO", "TERCEIROS", "CORPORATIVAS",
                                    "CONTRIBUICAO", "CONTRIBUICOES"]),
    ("VALORES RETIDOS DO SEGURADO", ["CONTRIBUICAO", "PREVIDENCIARIA", "FOLHA", "RAT",
                                     "SALARIO DE CONTRIBUICAO", "IMPOSTO DE RENDA"]),
    ("PAT",                        ["PAT", "ALIMENTACAO", "IRPJ", "LUCRO"]),
    ("APRENDIZES",                 ["APRENDIZ", "APRENDIZES", "CONTRIBUICAO", "FOLHA",
                                    "RAT", "TERCEIROS", "PREVIDENCIARIA"]),
    ("TEMA 69",                    ["ICMS", "EXCLUSAO - ICMS", "BASE DE CALCULO", "PIS",
                                    "COFINS", "FATURAMENTO"]),
    ("RECEITAS FINANCEIRAS",       ["PIS", "COFINS", "RECEITA", "RECEITAS", "FINANCEIRA",
                                    "FINANCEIRAS", "NAO CUMULATIVIDADE"]),
    ("ISS",                        ["ISS", "SERVICO"]),
    ("MAJORACAO",                  ["LUCRO PRESUMIDO", "ADICIONAL", "MAJORACAO", "IRPJ"]),
    ("PIS E DA COFINS DA SUA BASE",["PIS", "COFINS", "BASE DE CALCULO", "NAO CUMULATIVIDADE"]),
    ("VERBAS INDENIZATORIAS",      ["CONTRIBUICAO", "FOLHA", "SALARIO DE CONTRIBUICAO"]),
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
    for marcador, kws in CORROB:
        if _norm(marcador) in tn:
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
    for nome, rg in regras_tese():
        if _norm(nome) not in catalogo_norm:
            continue  # tese não está no catálogo do escritório
        if "all" in rg and not all(_tem(t, texto) for t in rg["all"]):
            continue
        if "any" in rg and not any(_tem(t, texto) for t in rg["any"]):
            continue
        # confiança base da regra; hint presente sobe "media" -> "alta"
        conf = rg.get("conf", "media")
        if conf == "media" and any(_tem(t, texto) for t in rg.get("hint", [])):
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
    args = ap.parse_args()
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
            browser = p.chromium.connect_over_cdp(f"http://localhost:{args.port}")
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
                _processar_cnpj(page, ctx, cnpj_digits, graus, catalogo, catalogo_norm,
                                args.inspect, args.autos, args.gravar)
                if eid:
                    sb_patch(f"empresas?id=eq.{eid}", {
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
                base = "https://" + url.split("/")[2]
                if r.get("det"):
                    # PJe 1.x (consulta do advogado): detalhe por URL direta
                    a1, o1, p1 = _detalhe_peticao_1x(ctx, base, r["det"])
                    r["assunto_fonte"], r["orgao_fonte"], r["peticao"] = a1, o1, p1
                elif grau in ("1x", "2x"):
                    # PJe 1.x TERCEIROS: postback + modal de motivo -> aba nova
                    det = _abrir_detalhe_terceiros(page, ctx, r["proc"])
                    if det is not None:
                        try:
                            a1, o1, p1 = _extrair_detalhe_1x(det, ctx, base)
                            r["assunto_fonte"], r["orgao_fonte"], r["peticao"] = a1, o1, p1
                        finally:
                            try: det.close()
                            except Exception: pass
                else:
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
        # assunto DA FONTE (tela de detalhe do 1.x) tem prioridade sobre o DataJud,
        # que é notoriamente impreciso. Só cai no DataJud quando a fonte não veio.
        c["assunto"] = c.get("assunto_fonte") or ("; ".join(assuntos) if assuntos else "")
        tese, conf = classificar_tese(c["assunto"], classe_dj or c.get("classe") or "",
                                      catalogo_norm, c.get("peticao", ""))
        c["tese"], c["conf"] = tese, conf
        # só CRAVA a tese se o assunto do DataJud CORROBORA a petição; senão fica
        # como sugestão (evita cravar tese errada quando a petição casou termo solto
        # ou o assunto está vazio — processo novo não indexado).
        c["corrob"] = assunto_corrobora(tese, c["assunto"]) if tese else False
        c["fonte_tese"] = "petição" if c.get("peticao") else "assunto(DataJud)"

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
            body = [{
                "empresa_id": empresa_id, "numero": c["proc"], "grau": c["grau"],
                "classe": c.get("classe"), "orgao": c.get("orgao"),
                "situacao": c.get("situacao"), "polo": "ativo",
                "assunto": c.get("assunto") or None,
                # crava acao_id só se corroborado; senão tese vai como SUGESTÃO
                "acao_id": (TESE_ID.get(_norm(c["tese"]))
                            if (c.get("tese") and c.get("corrob")) else None),
                "metadados": ({"tese_sugerida": c["tese"], "conf": c.get("conf")}
                              if (c.get("tese") and not c.get("corrob")) else {}),
                "fonte": "pje_tjrn+datajud",
            } for c in persistir]
            try:
                sb_upsert("empresa_processos_tributarios", body, "empresa_id,numero")
                print(f"  [gravar] {len(body)} processo(s) tributário(s) gravado(s) no CRM.")
            except Exception as e:
                print(f"  [gravar] falha: {e}")


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
            if esperado == 0 or st["n"] >= esperado:
                break
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


def _empresa_polo(razao, ativo, passivo):
    """Em qual polo a empresa está. Casa por TOKENS (todos presentes), não por
    substring contígua: a chave contígua quebrava em nomes com palavras curtas
    — 'DOIS A ENGENHARIA E TECNOLOGIA' virava 'DOIS ENGENHARIA TECNOLOGIA',
    que não existe no texto, e a empresa AUTORA era descartada como ré."""
    toks = [t for t in _norm(razao).split()
            if len(t) > 2 and t not in _SUFIXOS_GENERICOS][:4]
    if not toks:
        return "?"

    def bate(txt):
        t = _norm(txt)
        return all(tok in t for tok in toks)

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


def _abrir_detalhe_terceiros(page, ctx, proc):
    """Abre o DETALHE a partir da lista de Terceiros do 1.x. O link é um postback
    A4J (não tem URL) e o PJe exige informar o MOTIVO da consulta num modal —
    a textarea precisa de CLIQUE antes de digitar (fill direto não funciona).
    Retorna a página de detalhe (aba nova) ou None."""
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
        return None
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
                h.click()                                   # sem o clique não digita
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
        return det
    except Exception:
        return None


def _peticao_pdf_1x(ctx, base, id_processo):
    """PJe 1.x: TEXTO COMPLETO da petição inicial (PDF), via Paginador.

    Receita descoberta ao vivo (a inicial não aparece nos 15 docs da tela de
    detalhe e o documentoHTML só diz "Em PDF."):
      1. abre  /pje/Processo/Paginador/paginator.seam?idProcesso=N
      2. selecionarFimPaginador()  -> vai ao documento MAIS ANTIGO = a inicial
      3. na lista de binários, a PEÇA é a que NÃO se chama "Doc. NN - ..."
         (essas são os anexos: procuração, contrato social, etc.)
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
            _ate(pg, tipo_doc, 20, diferente_de=atual)
        idx = pg.evaluate(r"""() => {
          const todos = [...document.querySelectorAll('a')];
          let cand = -1;
          todos.forEach((a, i) => {
            if (!/jsfcljs/.test(a.getAttribute('onclick') || '')) return;
            const tr = a.closest('tr'); if (!tr) return;
            const t = tr.innerText.replace(/\s+/g, ' ').trim();
            if (!/\d{2}\/\d{2}\/\d{4}/.test(t)) return;
            if (/Doc\.\s*\d+\s*-/i.test(t)) return;      // anexo, não a peça
            if (cand < 0) cand = i;
          });
          return cand;
        }""")
        if idx is None or idx < 0:
            return ""
        urls.clear()
        pg.query_selector_all("a")[idx].click()
        # espera o PDF chegar (em vez de 7s fixos) — costuma vir em 1-3s
        for _ in range(30):
            if any("application/pdf" in ct for ct, _u in urls):
                break
            pg.wait_for_timeout(500)
        alvo = next((u for ct, u in urls if "application/pdf" in ct), None)
        if not alvo:
            return ""
        r = pg.request.get(alvo, timeout=60000)
        data = r.body()
        if data[:4] != b"%PDF":
            return ""
        import io as _io
        import pypdf
        rd = pypdf.PdfReader(_io.BytesIO(data))
        return "\n".join((x.extract_text() or "") for x in rd.pages[:8])
    except Exception:
        return ""
    finally:
        if pg is not None:
            try: pg.close()
            except Exception: pass


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
            linha += (f"\n        => TESE: {tese.strip()} (confiança {it.get('conf')}"
                      f", fonte: {it.get('fonte_tese','?')}, assunto CORROBORA)")
            teses_ja.setdefault(tese, []).append(it["proc"])
        elif tese:
            linha += (f"\n        => tese SUGERIDA (assunto não confirma — revisar): {tese.strip()}")
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
