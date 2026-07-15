# -*- coding: utf-8 -*-
"""
pje_rn_skiptrace.py — enriquece CONTATO dos sócios das empresas RN a partir do
PJe-TJRN (1º grau), reusando a SESSÃO LOGADA (certificado A3) no próprio browser.

POR QUÊ ASSIM: o TJRN não tem o Cloudflare que trava o TJPB, e o A3 (token) não
permite o MNI/.pfx em Python — então o caminho é dirigir o browser autenticado.
Diferente do TJPB, aqui os autos abrem e a camada de TEXTO do PDF.js é extraível
direto (sem OCR). A qualificação (CPF, endereço, telefone) está na petição inicial.

FLUXO (por sócio):
  1. Consulta por "Nome da Parte" no TJRN → lista de processos (prioriza onde o
     sócio é POLO ATIVO — é onde a procuração/qualificação dele aparece).
  2. Abre os autos → primeiro documento (petição inicial) → lê a camada de texto.
  3. Extrai CPF/endereço/telefone/email + advogado; CONFIRMA pelo CPF mascarado
     que já temos do QSA (***NNNNNN**). Só grava no match.
  4. Grava em empresa_contatos (telefone/email se houver; endereço/adv/proc em
     observacoes). Resumível: pula quem já tem observacoes 'PJe/TJRN'.

LGPD/uso: roda na SUA máquina, na SUA sessão (advogado), sobre autos públicos.
Minimização: persiste só o que serve pra contato; CPF cheio usado só pra conferir.

PRÉ-REQUISITOS:
  pip install playwright && playwright install chromium
  set SUPABASE_URL=...  &  set SUPABASE_SERVICE_ROLE_KEY=...

USO:
  python tools/pje_rn_skiptrace.py --limit 30            # piloto
  python tools/pje_rn_skiptrace.py --limit 30 --dry-run  # não grava, só mostra
  # 1) abre o Chrome (perfil persistente), você loga no TJRN com o A3 UMA vez,
  #    volta no terminal e tecla ENTER. O script varre o lote sozinho.
"""
import os, sys, re, csv, json, time, argparse, unicodedata
from pathlib import Path
import urllib.request, urllib.parse

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
CONSULTA = "https://pje1g.tjrn.jus.br/pje/Processo/ConsultaProcesso/listView.seam"
PROFILE = str(ROOT / ".pje-chrome-profile")
LEDGER = ROOT / "pje_rn_ledger.jsonl"  # registro do que JÁ foi varrido (hit ou miss)

RE_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
RE_CEP = re.compile(r"\b\d{2}\.?\d{3}-?\d{3}\b")
RE_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
RE_TEL = re.compile(r"(?<!\d)(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}(?!\d)")
# telefone ROTULADO ("Tel/Fone/Celular/Contato/WhatsApp: (XX) 9XXXX-XXXX") —
# alta precisão: o rótulo praticamente garante que é o contato da parte.
RE_TEL_LABEL = re.compile(
    r"(?:tel(?:efone)?|fone|celular|cel|contato|whats\s*app|whatsapp|zap)"
    r"\s*(?:para\s+contato\s*)?[\s.:)\-]*"
    r"(\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4})", re.I)
RE_ADV = re.compile(r"ADVOGADO\(A\)\s+AUTOR:\s*([^\n]+)", re.I)
# endereço — formatos: petição ("residente/domiciliad... na <END> ... CEP"),
# "com endereço na", "estabelecid... na", e exec. fiscal ("Endereço: <END> CEP").
RE_END = re.compile(
    r"(?:residente\s+e\s+)?domiciliad[oa]s?\s+n[ao]s?\s+"
    r"(.{8,180}?(?:CEP[:\s]*)?\d{2}\.?\d{3}-?\d{3})", re.I | re.S)
RE_END2 = re.compile(r"Endere[çc]o[:\s]+(.{8,170}?\d{5}-?\d{3})", re.I)
RE_END3 = re.compile(
    r"(?:residente|estabelecid[oa]s?|com\s+endere[çc]o|sede)\s+"
    r"(?:e\s+domiciliad[oa]s?\s+)?n[ao]s?\s+(.{8,180}?\d{5}-?\d{3})", re.I | re.S)


# ---------------------------------------------------------------------------
# Supabase REST
# ---------------------------------------------------------------------------
def sb(path, method="GET", body=None, prefer=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
               "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=40) as r:
        txt = r.read().decode("utf-8")
        return json.loads(txt) if txt.strip() else None


# Tokens que denunciam pessoa JURÍDICA figurando como "sócio" (holding sócia de
# outra empresa). Não têm CPF a conferir e só poluem a fila — pulamos.
_PJ_TOKENS = (
    " LTDA", " S/A", " S.A", " S A ", "EIRELI", " EPP", " MEI ", " ME ",
    "HOLDING", "EMPREENDIMENT", "INCORPORA", "PARTICIPAC", "PARTICIPAÇ",
    " S/S", "ASSOCIAD", "CONSTRUC", "CONSTRUÇ", "SERVIC", "SERVIÇ",
    "COMERC", "COMÉRC", "INDUSTR", "INDÚSTR", "CONSULTOR", "ARQUITET",
    "ENGENHAR", "IMOBILIAR", "AGROPEC", "TRANSPORT", "EMPRESA", "COMPANHIA",
    " CIA ", "SOCIEDADE", "NEGOCIO", "NEGÓCIO", "INVESTIMENT", "GESTAO",
    "GESTÃO", "FRANQUIA", "GRUPO ", "CONDOMINIO", "CONDOMÍNIO", "ESPOLIO",
    "ESPÓLIO", "MASSA FALIDA", "FUNDO ", "COOPERATIV",
    # + kaizen 14/07 (lote focado ação ICMS): sócios-PJ que passavam do filtro
    "ADMINISTRA", "DISTRIBUID", "ATACAD", "REPRESENTAC", "REPRESENTAÇ",
    "LOGISTIC", "LOGÍSTIC", "PATRIMONIAL", "IMPORTAC", "IMPORTAÇ",
    "EXPORTAC", "EXPORTAÇ", "SUPERMERCAD", "LABORATOR", "FACTORING",
    "SECURITIZ", "AGROIND", "FRIGORIF",
    "LOCADORA", "LOCACAO", "LOCAÇÃO", "VAREJ", "ATACADIST",
)


def parece_pj(nome):
    """True se o nome aparenta ser empresa (dígito ou token corporativo)."""
    n = f" {(nome or '').upper().strip()} "
    if any(ch.isdigit() for ch in n):
        return True
    return any(tok in n for tok in _PJ_TOKENS)


def ledger_nomes():
    """Nomes (UPPER) já varridos numa execução REAL (hit ou miss) — pula no resume."""
    s = set()
    if LEDGER.exists():
        for line in open(LEDGER, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                s.add((json.loads(line).get("nome") or "").upper())
            except Exception:
                pass
    return s


def ledger_add(nome, mask, result, flags=""):
    """Anexa o resultado da varredura de um sócio (só em runs reais)."""
    with open(LEDGER, "a", encoding="utf-8") as f:
        f.write(json.dumps({"nome": nome, "mask": mask, "result": result,
                            "flags": flags}, ensure_ascii=False) + "\n")


MARKER = "PJe/TJRN"  # marcador em observacoes; reatribuído por --tj em main()

# Config por tribunal PJe (o parser/busca são padrão PJe; muda só URL/UF/marcador).
# default 'rn' = TJRN (comportamento atual, sem regressão). 'trf5' = Justiça Federal
# 5ª Região (RN/PB/PE/CE/AL/SE) — pega os processos FEDERAIS dos sócios do NE
# (execução fiscal da União/tributário — a tese FreireTax). Mesmo DOM do PJe TJRN.
TJ = {
    "rn": {"nome": "TJRN", "ufs": ["RN"],
           "consulta": "https://pje1g.tjrn.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
           "marker": "PJe/TJRN", "profile": ".pje-chrome-profile", "ledger": "pje_rn_ledger.jsonl"},
    "trf5": {"nome": "TRF5", "ufs": ["RN", "PB", "PE", "CE", "AL", "SE"],
             "consulta": "https://pje1g.trf5.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
             "marker": "PJe/TRF5", "profile": ".pje-trf5-chrome-profile", "ledger": "pje_trf5_ledger.jsonl"},
}


def _alvos_query(ufs):
    flt = (f"empresas.uf=in.({','.join(ufs)})" if len(ufs) > 1 else f"empresas.uf=eq.{ufs[0]}")
    return ("empresa_contatos?select=id,empresa_id,nome,cpf_mascarado,telefone,email,"
            "observacoes,empresas!inner(uf)&papel=eq.socio&cpf_mascarado=not.is.null"
            f"&cpf_mascarado=like.*%2A*&{flt}&order=nome.asc")


# query base dos alvos (default RN) — usada aqui e no painel; reatribuída por --tj
ALVOS_QUERY = _alvos_query(["RN"])


def engaged_empresa_ids():
    """empresa_ids onde o escritório está ATIVAMENTE engajado (prospecção, proposta,
    reunião ou tarefa). Sócios dessas empresas são PRIORIDADE: quando o usuário for
    trabalhar o caso, o contato (CPF/telefone) já está no CRM em vez de espalhado por
    semanas de varredura alfabética. Reach pequeno (~dezenas), alto valor; tabela
    ausente/erro não derruba o lote (cai pro alfabético)."""
    ids = set()
    for tbl in ("prospeccoes", "propostas", "reunioes", "tarefas"):
        try:
            for r in (sb(f"{tbl}?select=empresa_id&empresa_id=not.is.null&limit=10000") or []):
                if r.get("empresa_id"):
                    ids.add(r["empresa_id"])
        except Exception:
            pass
    return ids


def acao_empresa_ids(acao_id, ufs):
    """empresa_ids das UFs alvo vinculados a uma AÇÃO (via elegibilidade) — pra
    lote FOCADO nos sócios das empresas de uma tese específica, em vez do sweep
    alfabético. Filtra por UF no servidor pra a lista IN não estourar a URL."""
    flt = (f"empresas.uf=in.({','.join(ufs)})" if len(ufs) > 1 else f"empresas.uf=eq.{ufs[0]}")
    ids = set()
    for r in (sb(f"elegibilidade?select=empresa_id,empresas!inner(uf)"
                 f"&acao_id=eq.{acao_id}&{flt}&limit=10000") or []):
        if r.get("empresa_id"):
            ids.add(r["empresa_id"])
    return ids


def carregar_socios(limit, priorizar_engajados=True, restrict_empresa_ids=None):
    """Sócios RN pessoa-física ainda não varridos. Prioriza sócios de empresas
    engajadas e DEPOIS segue alfabético; pula os já varridos (ledger), já enriquecidos
    (marcador) e PJ. Ledger+marcador garantem que ninguém é re-processado.
    restrict_empresa_ids: se setado, limita a varredura a essas empresas (lote focado)."""
    done = ledger_nomes()
    vistos, alvos = set(), []
    # Lote focado numa ação: restringe a query às empresas da ação (ignora a
    # priorização por engajamento — o próprio recorte já é o foco).
    restrict = ""
    if restrict_empresa_ids:
        priorizar_engajados = False
        restrict = f"&empresa_id=in.({','.join(str(x) for x in restrict_empresa_ids)})"

    def _coletar(extra=""):
        extra = restrict + extra
        offset, page = 0, 1000
        while len(alvos) < limit:
            rows = sb(ALVOS_QUERY + extra + f"&limit={page}&offset={offset}") or []
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

    # 1) prioridade: sócios de empresas engajadas (alto valor, reach pequeno)
    if priorizar_engajados:
        eng = engaged_empresa_ids()
        if eng:
            _coletar(f"&empresa_id=in.({','.join(str(x) for x in eng)})")
            if alvos:
                print(f">>> {len(alvos)} sócio(s) de empresas ENGAJADAS priorizados "
                      "(prospecção/proposta/reunião/tarefa).", flush=True)
    # 2) preenche o resto em ordem alfabética
    _coletar()
    return alvos


def mask_digits(mask):
    """'***395054**' -> '395054' (os 6 dígitos visíveis do meio)."""
    return re.sub(r"\D", "", mask or "")


def cpf_confere(cpf_full, mask):
    d = re.sub(r"\D", "", cpf_full or "")
    vis = mask_digits(mask)
    if len(d) != 11 or len(vis) != 6:
        return False
    return d[3:9] == vis  # CPF d3..d8 == 6 dígitos do meio da máscara


# ---------------------------------------------------------------------------
# Parsing da qualificação
# ---------------------------------------------------------------------------
def limpa(txt):
    # PJe quebra números com espaços/'\n-\n' ("344 - 87", "59.075 - 250",
    # "99907 - 9637"); junta tudo e cola os números pra os regex baterem.
    t = txt.replace("­", "")
    t = re.sub(r"\s*\n\s*", " ", t)
    t = re.sub(r"(\d)\s*-\s*(\d)", r"\1-\2", t)   # hífen entre dígitos (CPF/CEP)
    t = re.sub(r"(\d)\s*\.\s*(\d)", r"\1.\2", t)   # ponto entre dígitos
    t = re.sub(r"\s{2,}", " ", t)
    return t


_RE_RUA = re.compile(
    r"\b(RUA|R\.|AV\.?|AVENIDA|TRAVESSA|TRAV\.?|ROD\.?|RODOVIA|ESTRADA|"
    r"PRA[CÇ]A|QUADRA|QD\.?|CONJUNTO|CONJ\.?|SETOR|ST\.?|LOTEAMENTO|LOT\.?|"
    r"VILA|ALAMEDA|AL\.?|LARGO|BECO|PASSAGEM)\b", re.I)


def _janela_alvo(t, alvo_nome):
    """Janela no bloco de QUALIFICAÇÃO do alvo (onde nome e CPF coexistem).
    Evita pegar dado do réu/exequente e ancora telefone/endereço no alvo."""
    up = t.upper()
    nome_up = alvo_nome.upper().strip()
    starts = [m.start() for m in re.finditer(re.escape(nome_up), up)]
    if not starts:
        toks = [w for w in nome_up.split() if len(w) > 2]
        if toks:
            starts = [m.start() for m in re.finditer(re.escape(toks[0]), up)]
    if not starts:
        return t[:1000]
    # prefere a ocorrência cuja janela à frente contém CPF (= qualificação)
    for s in starts:
        if RE_CPF.search(t[s: s + 750]):
            return t[max(0, s - 80): s + 900]
    return t[max(0, starts[0] - 80): starts[0] + 900]


def _ctx_advogado(txt, start):
    """True se o trecho antes da posição é de advogado/OAB/procurador (telefone
    alheio). Janela 90 chars (era 40) — pega "advogado(a) Fulano ..., tel:" onde
    o rótulo fica mais longe do número."""
    ctx = txt[max(0, start - 90): start].upper()
    return "OAB" in ctx or "ADVOGAD" in ctx or "PROCURADOR" in ctx


def _telefone(jan, full):
    # 1) rotulado na janela do alvo (mais confiável)
    for m in RE_TEL_LABEL.finditer(jan):
        if len(re.sub(r"\D", "", m.group(1))) in (10, 11) and not _ctx_advogado(jan, m.start()):
            return m.group(1).strip()
    # 2) cru na janela do alvo, evitando telefone colado em OAB/advogado
    for m in RE_TEL.finditer(jan):
        if len(re.sub(r"\D", "", m.group(0))) in (10, 11) and not _ctx_advogado(jan, m.start()):
            return m.group(0).strip()
    # 3) rotulado no documento todo (último recurso; ainda evita advogado)
    for m in RE_TEL_LABEL.finditer(full):
        if len(re.sub(r"\D", "", m.group(1))) in (10, 11) and not _ctx_advogado(full, m.start()):
            return m.group(1).strip()
    return ""


def _limpa_endereco(end):
    end = re.sub(r"\s+", " ", end).strip(" .,;-")
    # corta prefixo lixo antes do logradouro ("...na cidade de X, na RUA ...")
    m = _RE_RUA.search(end)
    if m and m.start() < 70:
        end = end[m.start():].strip(" .,;-")
    return end


RE_EMAIL_ADV = re.compile(r"advoc|advogad|\.adv|jurid|\boab\b", re.I)


def _sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def _email_do_alvo(jan, alvo_nome):
    """E-mail da janela que é do SÓCIO, não do advogado. Rejeita contexto
    OAB/advogado/procurador (nas ~120 chars anteriores) e domínio jurídico, e
    exige que o local-part case com um pedaço do nome do sócio — petição quase
    sempre traz o e-mail do ADVOGADO (endereço de intimação), então só guardamos
    o que comprovadamente casa o sócio (política 'médio')."""
    toks = [t for t in re.split(r"[^a-z]+", _sem_acento(alvo_nome).lower()) if len(t) >= 3]
    for m in RE_EMAIL.finditer(jan):
        e = m.group(0)
        low = e.lower()
        if "latam" in low:
            continue
        ctx = jan[max(0, m.start() - 120): m.start()].upper()
        if "OAB" in ctx or "ADVOGAD" in ctx or "PROCURADOR" in ctx:
            continue
        if RE_EMAIL_ADV.search(low):
            continue
        local = low.split("@", 1)[0]
        if any(t in local for t in toks):
            return e
    return ""


def parse_qualificacao(txt_raw, alvo_nome, mask=None):
    t = limpa(txt_raw)
    out = {"cpf": "", "endereco": "", "cep": "", "telefone": "", "email": "", "advogado": ""}
    # Âncora preferida: a CPF do documento que CONFIRMA a máscara do alvo.
    # Resolve docs com vários CPFs (autor + terceiros) e nome longe da
    # qualificação — ancora endereço/telefone no bloco da pessoa certa.
    anchor = None
    if mask:
        for mm in RE_CPF.finditer(t):
            if cpf_confere(mm.group(0), mask):
                out["cpf"] = mm.group(0)
                anchor = mm.start()
                break
    if anchor is not None:
        jan = t[max(0, anchor - 380): anchor + 520]
    else:
        jan = _janela_alvo(t, alvo_nome)
        mcpf = RE_CPF.search(jan) or RE_CPF.search(t)
        if mcpf:
            out["cpf"] = mcpf.group(0)
    # endereço: PRIORIZA a janela do alvo (evita o do réu/exequente);
    # só cai pro texto todo se a janela não tiver endereço.
    mend = (RE_END.search(jan) or RE_END3.search(jan) or RE_END2.search(jan)
            or RE_END.search(t) or RE_END3.search(t) or RE_END2.search(t))
    if mend:
        out["endereco"] = _limpa_endereco(mend.group(1))
        mcep = RE_CEP.search(out["endereco"])
        if mcep:
            out["cep"] = mcep.group(0)
    out["telefone"] = _telefone(jan, t)
    # email: só o do SÓCIO — rejeita advogado/OAB + domínio jurídico e exige
    # casar o nome do sócio no local-part (e-mail de petição ~ sempre do adv).
    out["email"] = _email_do_alvo(jan, alvo_nome)
    madv = RE_ADV.search(txt_raw)
    if madv:
        out["advogado"] = re.sub(r"\s+", " ", madv.group(1)).strip()
    return out


# ---------------------------------------------------------------------------
# Browser (Playwright) — reusa a sessão logada A3
# ---------------------------------------------------------------------------
def pesquisar(page, nome):
    page.goto(CONSULTA, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1200)
    # detecta sessão caída na hora (form ausente = deslogou) — não espera 30s
    if not page.query_selector("input[id*='nomeParte']"):
        raise RuntimeError("sessao expirada (form de consulta ausente)")
    # campo Nome da Parte + botão Pesquisar (PJe 2.x)
    page.fill("input[id*='nomeParte']", nome)
    page.click("input[value='Pesquisar'], button:has-text('Pesquisar')")
    # espera o overlay a4j sumir
    for _ in range(40):
        page.wait_for_timeout(700)
        vis = page.evaluate(
            "() => { const e=document.querySelector('[id$=\"status.start\"]');"
            "return e ? getComputedStyle(e).display!=='none' : false; }")
        if not vis:
            break
    page.wait_for_timeout(600)
    # lê linhas de resultado: proc, polo ativo/passivo, e o índice da linha
    return page.evaluate(r"""() => {
      const rows = [...document.querySelectorAll('table tr')].map((tr, idx) => {
        const m = tr.innerText.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
        if (!m) return null;
        const cells = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
        return { proc: m[0], idx, texto: tr.innerText.replace(/\s+/g,' ').trim(), cells };
      }).filter(Boolean);
      return rows;
    }""")


def _fechar_abas_extras(page):
    """Fecha abas órfãs de autos (que não fecharam), deixa só a consulta —
    evita acúmulo de abas que trava a abertura de novos processos."""
    try:
        for pg in list(page.context.pages):
            if pg is not page:
                try:
                    pg.close()
                except Exception:
                    pass
    except Exception:
        pass


def abrir_e_extrair(page, proc):
    """Clica no link do processo (abre nova aba), vai ao 1º doc, extrai texto, fecha."""
    ctx = page.context
    with ctx.expect_page(timeout=20000) as pinfo:
        page.evaluate("""(proc) => {
          const tr=[...document.querySelectorAll('table tr')].find(t=>t.innerText.includes(proc));
          const a=tr && [...tr.querySelectorAll('a')].find(x=>x.textContent.includes(proc));
          if(a) a.click();
        }""", proc)
    autos = pinfo.value
    autos.wait_for_load_state("domcontentloaded")
    autos.wait_for_timeout(2500)
    try:
        # primeiro documento
        autos.click("a[title='Primeiro documento'], [aria-label='Primeiro documento']", timeout=8000)
    except Exception:
        pass
    autos.wait_for_timeout(2000)
    txt = ""
    for k in range(16):
        txt = autos.evaluate(r"""() => {
          const ifr=[...document.querySelectorAll('iframe')].find(f=>/pdfjs|viewer\.html/.test(f.src||''));
          if(!ifr) return '';
          try { const d=ifr.contentDocument; if(!d) return '';
            let t=''; d.querySelectorAll('.textLayer').forEach(l=>t+=l.innerText+'\n');
            return t || (d.body?d.body.innerText:''); } catch(e){ return ''; }
        }""")
        # a toolbar do PDF.js sozinha tem ~220 chars; só aceita conteúdo real
        # (texto longo OU com CPF) — senão segue esperando o textLayer renderizar.
        if txt and (len(txt) > 600 or RE_CPF.search(txt)):
            break
        # bail rápido (~7s): PDF imagem/escaneado nunca renderiza textLayer —
        # se travou no tamanho da toolbar, não adianta esperar os 14s.
        if k >= 7 and len(txt or "") < 300:
            break
        autos.wait_for_timeout(900)
    try:
        autos.close()
    except Exception:
        pass
    return txt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dump", action="store_true",
                    help="salva o texto cru dos autos em pje_rn_dump.jsonl (corpus p/ reparse)")
    ap.add_argument("--reparse", metavar="JSONL",
                    help="reprocessa um corpus salvo (SEM browser) e mostra o rendimento")
    ap.add_argument("--acao", metavar="ACAO_ID",
                    help="lote FOCADO: só sócios das empresas vinculadas a esta ação (elegibilidade)")
    ap.add_argument("--names-file", metavar="JSON",
                    help="busca uma lista CUSTOM de alvos [{nome,cpf_mascarado}] no tribunal "
                         "(ex: sócios PB de CNPJs-alvo) em vez do sweep por UF. "
                         "Ledger próprio (pje_<tj>_names_ledger.jsonl), resumível.")
    ap.add_argument("--tj", default="rn", choices=list(TJ),
                    help="tribunal PJe: rn (TJRN, default) | trf5 (Justiça Federal 5ª Reg: "
                         "RN/PB/PE/CE/AL/SE — processos FEDERAIS dos sócios do NE)")
    ap.add_argument("--cdp", action="store_true",
                    help="conecta no Chrome REAL (--remote-debugging-port) p/ login A3/PDPJ "
                         "(federal/Keycloak que o Chromium do Playwright não apresenta o A3)")
    ap.add_argument("--port", type=int, default=9222, help="porta CDP (default 9222)")
    args = ap.parse_args()
    # modo offline: afina o parser sobre o corpus salvo, zero requisição ao TJRN
    if args.reparse:
        return reparse_main(args.reparse)
    if not SUPABASE_URL or not SERVICE_KEY:
        print("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); sys.exit(1)
    dump_path = ROOT / "pje_rn_dump.jsonl"  # corpus só é resetado após login OK

    # aplica a config do tribunal (--tj). default 'rn' = comportamento original.
    global CONSULTA, PROFILE, LEDGER, ALVOS_QUERY, MARKER
    _c = TJ[args.tj]
    CONSULTA = _c["consulta"]
    PROFILE = str(ROOT / _c["profile"])
    LEDGER = ROOT / _c["ledger"]
    MARKER = _c["marker"]
    ALVOS_QUERY = _alvos_query(_c["ufs"])

    from playwright.sync_api import sync_playwright

    if args.names_file:
        # modo lista-custom: alvos vêm de um JSON (não do sweep). Ledger próprio
        # p/ não misturar com a frente por-UF e ser resumível por conta própria.
        LEDGER = ROOT / f"pje_{args.tj}_names_ledger.jsonl"
        raw = json.load(open(args.names_file, encoding="utf-8"))
        done = ledger_nomes()
        alvos = [a for a in raw if a.get("nome") and a.get("cpf_mascarado")
                 and a["nome"].upper() not in done][:args.limit]
        print(f"> {len(alvos)} alvos custom (de {len(raw)}; {len(done)} já no ledger próprio) "
              f"a BUSCAR no {_c['nome']}. Ledger: {LEDGER.name}")
    elif args.acao:
        # lote FOCADO: só sócios das empresas da ação (nas UFs do TJ)
        restrict = acao_empresa_ids(args.acao, _c["ufs"])
        if not restrict:
            print(f"> Nenhuma empresa da ação {args.acao} nas UFs {'/'.join(_c['ufs'])}. Nada a fazer.")
            return
        alvos = carregar_socios(args.limit, restrict_empresa_ids=restrict)
        print(f"> {len(alvos)} sócios FOCADOS na ação ({len(restrict)} empresas {'/'.join(_c['ufs'])}) "
              f"a processar no {_c['nome']} (sem enriquecimento {_c['marker']}).")
    else:
        alvos = carregar_socios(args.limit)
        print(f"> {len(alvos)} sócios ({'/'.join(_c['ufs'])}) a processar no {_c['nome']} "
              f"(pessoa física, sem enriquecimento {_c['marker']}).")

    out_csv = ROOT / "pje_rn_skiptrace.csv"
    resultados = []
    with sync_playwright() as p:
        if args.cdp:
            # login A3/PDPJ no Chrome REAL (aberto via chrome-cdp.ps1); o Chromium
            # do Playwright não apresenta o A3 no SSO Keycloak (federal/PDPJ).
            browser = p.chromium.connect_over_cdp(f"http://localhost:{args.port}")
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        else:
            ctx = p.chromium.launch_persistent_context(PROFILE, headless=False,
                                                        viewport={"width": 1280, "height": 900})
        # Aceita automaticamente o aviso CNJ Res.121 (acesso a autos) em toda aba.
        # O acesso é do advogado a empresas que já patrocina/tem acesso (autorizado).
        ctx.on("page", lambda pg: pg.on("dialog", lambda d: d.accept()))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("dialog", lambda d: d.accept())
        page.goto(CONSULTA, wait_until="domcontentloaded")
        # Auto-detecta o login (não precisa teclar ENTER). NÃO navega enquanto
        # você ainda está na tela de login — só confirma quando o form da
        # consulta aparecer (carrega apenas autenticado). Até ~10 min.
        print(">>> Faça LOGIN no TJRN com o A3 na janela do Chrome que abriu.", flush=True)
        print(">>> (é a janela que foi direto para pje1g.tjrn.jus.br). Aguardando autenticação...", flush=True)
        LOGIN_MARKERS = ("sso", "/login", "login.seam", "auth", "openid",
                         "saml", "keycloak", "acesso.gov", "certificado")
        ok = False
        for it in range(300):  # ~10 min
            try:
                # 1) form presente em QUALQUER aba? (login pode redirecionar p/
                #    outra aba; usa essa aba dali pra frente)
                for pg in list(ctx.pages):
                    try:
                        if pg.query_selector("input[id*='nomeParte']"):
                            page = pg
                            ok = True
                            break
                    except Exception:
                        pass
                if ok:
                    break
                # 2) alguma aba já está no PJe TJRN fora da tela de login?
                #    navega ela pra consulta e confirma o form.
                alvo = None
                for pg in list(ctx.pages):
                    u = (pg.url or "").lower()
                    if ("tjrn.jus.br" in u) and not any(m in u for m in LOGIN_MARKERS):
                        alvo = pg
                        break
                # re-tenta a cada ~16s mesmo que pareça login (caso tenha caído
                # em painel/aba que não bate os markers), sem recarregar a toda hora
                if alvo is None and it % 8 == 7:
                    alvo = page
                if alvo is not None:
                    alvo.goto(CONSULTA, wait_until="domcontentloaded", timeout=30000)
                    alvo.wait_for_timeout(1500)
                    if alvo.query_selector("input[id*='nomeParte']"):
                        page = alvo
                        ok = True
                        break
            except Exception:
                pass
            time.sleep(2)
        if not ok:
            print("Timeout aguardando login. Saindo.")
            if not args.cdp:
                ctx.close()
            return
        print(">>> Autenticado. Iniciando varredura.", flush=True)
        if args.dump and dump_path.exists():
            dump_path.unlink()  # reseta corpus só agora (login falho não apaga)

        erros_seguidos = 0     # falhas seguidas na BUSCA (form ausente = sessão caiu)
        aberturas_falhas = 0   # sócios seguidos com processos mas NENHUM autos abriu
        enriquecidos = 0       # hits efetivamente gravados neste lote
        LIMITE_ABERTURA = 3    # autos não abrem N× seguidas = limite diário do TJRN
                               # (3 já é sinal forte; detecta o limite ~2 sócios antes)
        for i, s in enumerate(alvos, 1):
            nome, mask = s["nome"], s["cpf_mascarado"]
            try:
                rows = pesquisar(page, nome)
                erros_seguidos = 0
            except Exception as e:
                erros_seguidos += 1
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} ERRO busca: {str(e)[:60]}")
                if erros_seguidos >= 4:
                    print(">>> 4 erros seguidos — sessão provavelmente caiu. "
                          "Abortando lote (resumível, nada perdido). Relogue e rode de novo.")
                    break
                continue
            if not rows:
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} sem processo")
                if not args.dry_run:
                    ledger_add(nome, mask, "sem_processo")
                continue
            # prioriza processos onde o nome aparece no POLO ATIVO
            def ativo(r):
                cells = r.get("cells") or []
                pa = cells[5] if len(cells) > 5 else r["texto"]
                return nome.split()[0].upper() in (pa or "").upper()
            rows.sort(key=lambda r: (0 if ativo(r) else 1))
            got = None
            abriu_algum = False      # algum processo realmente abriu e rendeu texto?
            falha_abertura = False   # algum open lançou exceção (popup/aba não veio)
            # Kaizen: já vindo de falha de abertura (provável limite diário), tenta
            # só 1 proc em vez de 4 — corta ~60s de timeouts por sócio ao confirmar
            # o limite. Se abrir normal, aberturas_falhas zera e volta a 4.
            n_try = 1 if aberturas_falhas else 4
            for r in rows[:n_try]:
                try:
                    txt = abrir_e_extrair(page, r["proc"])
                except Exception as e:
                    # um processo que não abre (popup não veio, aba travou) não
                    # pode derrubar o lote — pula pro próximo processo.
                    print(f"     (falha ao abrir {r['proc'][:25]}: {str(e)[:40]})")
                    _fechar_abas_extras(page)
                    falha_abertura = True
                    continue
                if not txt:
                    continue
                abriu_algum = True
                if args.dump:
                    with open(dump_path, "a", encoding="utf-8") as df:
                        df.write(json.dumps({"nome": nome, "mask": mask, "proc": r["proc"],
                                             "ativo": ativo(r), "texto": txt}, ensure_ascii=False) + "\n")
                q = parse_qualificacao(txt, nome, mask)
                if q["cpf"] and cpf_confere(q["cpf"], mask):
                    q["proc"] = r["proc"]
                    got = q
                    break
                # se não achou CPF mas é claramente o polo ativo dele, guarda como fraco
                if not got and ativo(r) and (q["endereco"] or q["telefone"]):
                    q["proc"] = r["proc"]; q["fraco"] = True; got = q

            # LIMITE DIÁRIO vs QUEDA DE SESSÃO: o sócio TINHA processos na busca,
            # mas NENHUM autos abriu (todos deram erro). Isso NÃO é "sem match" —
            # os autos foram bloqueados. Como a busca segue funcionando (sessão A3
            # viva), é o LIMITE DIÁRIO do TJRN, não a sessão caída. Não ledgeriza
            # (re-tenta noutro dia) e conta como falha de abertura seguida.
            if not got and not abriu_algum and falha_abertura:
                aberturas_falhas += 1
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} {len(rows)} proc -> AUTOS NÃO ABRIRAM (não gravado)")
                if aberturas_falhas >= LIMITE_ABERTURA:
                    print(f">>> {aberturas_falhas} sócios seguidos: processos existem mas NENHUM autos abriu.")
                    print(">>> A BUSCA ainda funciona (sessão A3 viva) => é o LIMITE DIÁRIO do TJRN, não a sessão.")
                    print(">>> Relogar NÃO resolve. Pare hoje e retome amanhã (resumível; nada gravado errado).")
                    break
                continue
            aberturas_falhas = 0  # abriu algo (ou foi teto real de extração) -> zera

            flags = ""
            if got:
                flags = "".join(c for c, k in [("#", "cpf"), ("E", "endereco"), ("T", "telefone"), ("@", "email")] if got.get(k))
                resultados.append({"nome": nome, "mask": mask, **got})
                if not args.dry_run:
                    try:
                        gravar(s, got)
                    except Exception as e:
                        # erro de rede na gravação não pode derrubar lote longo —
                        # NÃO ledgeriza (retoma esse sócio depois).
                        print(f"     (falha ao gravar {nome[:20]}: {str(e)[:40]})")
                        time.sleep(1)
                        continue
                enriquecidos += 1
            if not args.dry_run:
                ledger_add(nome, mask, "hit" if got else "sem_match", flags)
            print(f"[{i}/{len(alvos)}] {nome[:30]:30} {len(rows)} proc -> {flags or 'sem match'}")
            time.sleep(0.5)
        if not args.cdp:
            ctx.close()

    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        if resultados:
            w = csv.DictWriter(f, fieldnames=list(resultados[0].keys())); w.writeheader(); w.writerows(resultados)
    com_tel = sum(1 for r in resultados if r.get("telefone"))
    grav = enriquecidos if not args.dry_run else 0
    print(f"\n> {len(resultados)} sócios com match (telefone:{com_tel}) | {grav} gravados no CRM. CSV: {out_csv.name}")


def avaliar_socio(cands, nome, mask):
    """Replica a escolha do loop ao vivo sobre candidatos JÁ extraídos.
    cands: lista de {proc, ativo, texto}. Retorna o melhor `got` ou None."""
    got = None
    for c in sorted(cands, key=lambda r: 0 if r.get("ativo") else 1):
        txt = c.get("texto") or ""
        if not txt:
            continue
        q = parse_qualificacao(txt, nome, mask)
        if q["cpf"] and cpf_confere(q["cpf"], mask):
            q["proc"] = c["proc"]
            return q
        if not got and c.get("ativo") and (q["endereco"] or q["telefone"]):
            q["proc"] = c["proc"]; q["fraco"] = True; got = q
    return got


def reparse_main(path):
    """Roda o parser atual sobre o corpus salvo (--dump) — sem browser.
    Permite iterar a extração e medir o rendimento em segundos."""
    import collections
    cands = collections.OrderedDict()
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            cands.setdefault((d["nome"], d["mask"]), []).append(d)
    n_cpf = n_end = n_tel = n_mail = n_match = 0
    for (nome, mask), cs in cands.items():
        got = avaliar_socio(cs, nome, mask)
        if not got:
            print(f"  {nome[:32]:32} {len(cs):2}d -> sem match")
            continue
        flags = "".join(c for c, k in [("#", "cpf"), ("E", "endereco"),
                                        ("T", "telefone"), ("@", "email")] if got.get(k))
        n_match += 1
        n_cpf += bool(got.get("cpf")); n_end += bool(got.get("endereco"))
        n_tel += bool(got.get("telefone")); n_mail += bool(got.get("email"))
        tel = got.get("telefone", "") or ""
        end = (got.get("endereco", "") or "")[:46]
        print(f"  {nome[:32]:32} {len(cs):2}d -> {flags:4} {tel:16} {end}")
    tot = len(cands)
    print(f"\n> REPARSE {tot} sócios | match {n_match} | CPF {n_cpf} | "
          f"end {n_end} | TEL {n_tel} | email {n_mail}")


def gravar(socio, q):
    """Atualiza o contato do sócio no CRM, escopado por nome E máscara de CPF
    (não sobrescreve homônimo com máscara diferente)."""
    nome = socio["nome"]
    obs = (f"{MARKER} (proc {q.get('proc','')}): "
           + (f"{q['endereco']}. " if q.get("endereco") else "")
           + (f"Adv: {q['advogado']}. " if q.get("advogado") else "")
           + ("CPF conferido pela mascara." if q.get("cpf") and not q.get("fraco") else "identidade provável (polo ativo)."))
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


if __name__ == "__main__":
    main()
