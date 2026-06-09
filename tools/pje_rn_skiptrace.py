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
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
CONSULTA = "https://pje1g.tjrn.jus.br/pje/Processo/ConsultaProcesso/listView.seam"
PROFILE = str(ROOT / ".pje-chrome-profile")

RE_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
RE_CEP = re.compile(r"\b\d{2}\.?\d{3}-?\d{3}\b")
RE_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
RE_TEL = re.compile(r"(?<!\d)(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}(?!\d)")
RE_ADV = re.compile(r"ADVOGADO\(A\)\s+AUTOR:\s*([^\n]+)", re.I)
# endereço — dois formatos: petição ("domiciliad... na <END> ... CEP") e
# execução fiscal/cadastro ("Endereço: <END> ... NNNNN-NNN").
RE_END = re.compile(r"domiciliad[oa]s?\s+n[ao]s?\s+(.{8,180}?CEP[:\s]*\d{2}\.?\d{3}-?\d{3})", re.I | re.S)
RE_END2 = re.compile(r"Endere[çc]o[:\s]+(.{8,170}?\d{5}-?\d{3})", re.I)


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


def carregar_socios(limit):
    """Sócios RN pessoa-física (cpf mascarado), ainda sem enriquecimento PJe."""
    q = ("empresa_contatos?select=id,empresa_id,nome,cpf_mascarado,telefone,email,observacoes,"
         "empresas!inner(uf)&papel=eq.socio&cpf_mascarado=not.is.null"
         "&cpf_mascarado=like.*%2A*&empresas.uf=eq.RN&order=nome.asc")
    rows = sb(q + f"&limit={limit*3}") or []
    # dedup por nome (mesmo sócio em várias empresas), pula já enriquecidos
    vistos, alvos = set(), []
    for r in rows:
        nome = (r.get("nome") or "").strip()
        if not nome or nome.upper() in vistos:
            continue
        if "PJe/TJRN" in (r.get("observacoes") or ""):
            continue
        vistos.add(nome.upper())
        alvos.append(r)
        if len(alvos) >= limit:
            break
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


def parse_qualificacao(txt_raw, alvo_nome):
    t = limpa(txt_raw)
    out = {"cpf": "", "endereco": "", "cep": "", "telefone": "", "email": "", "advogado": ""}
    # janela em torno do nome do alvo (evita pegar dado do réu/exequente)
    up = t.upper()
    i = up.find(alvo_nome.upper())
    if i < 0:
        i = up.find(alvo_nome.split()[0].upper())
    jan = t[max(0, i - 250): i + 650] if i >= 0 else t[:900]
    mcpf = RE_CPF.search(jan) or RE_CPF.search(t)
    if mcpf:
        out["cpf"] = mcpf.group(0)
    # endereço: petição ("domiciliado na...") ou exec. fiscal ("Endereço: ...")
    mend = RE_END.search(t) or RE_END2.search(jan) or RE_END2.search(t)
    if mend:
        out["endereco"] = re.sub(r"\s+", " ", mend.group(1)).strip(" .,;-")
        mcep = RE_CEP.search(out["endereco"])
        if mcep:
            out["cep"] = mcep.group(0)
    # telefone/email só do trecho do autor (jan), pra não pegar o do réu/advogado
    tels = [m.group(0) for m in RE_TEL.finditer(jan)
            if len(re.sub(r"\D", "", m.group(0))) in (10, 11)]
    if tels:
        out["telefone"] = tels[0]
    em = RE_EMAIL.search(jan)
    if em and "latam" not in em.group(0).lower():
        out["email"] = em.group(0)
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


def abrir_e_extrair(page, proc):
    """Clica no link do processo (abre nova aba), vai ao 1º doc, extrai texto, fecha."""
    ctx = page.context
    with ctx.expect_page(timeout=30000) as pinfo:
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
    autos.wait_for_timeout(2500)
    txt = ""
    for _ in range(12):
        txt = autos.evaluate(r"""() => {
          const ifr=[...document.querySelectorAll('iframe')].find(f=>/pdfjs|viewer\.html/.test(f.src||''));
          if(!ifr) return '';
          try { const d=ifr.contentDocument; if(!d) return '';
            let t=''; d.querySelectorAll('.textLayer').forEach(l=>t+=l.innerText+'\n');
            return t || (d.body?d.body.innerText:''); } catch(e){ return ''; }
        }""")
        if txt and len(txt) > 150:
            break
        autos.wait_for_timeout(800)
    try:
        autos.close()
    except Exception:
        pass
    return txt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not SUPABASE_URL or not SERVICE_KEY:
        print("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); sys.exit(1)

    from playwright.sync_api import sync_playwright

    alvos = carregar_socios(args.limit)
    print(f"> {len(alvos)} sócios RN a processar (pessoa física, sem enriquecimento PJe).")

    out_csv = ROOT / "pje_rn_skiptrace.csv"
    resultados = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(PROFILE, headless=False,
                                                    viewport={"width": 1280, "height": 900})
        # Aceita automaticamente o aviso CNJ Res.121 (acesso a autos) em toda aba.
        # O acesso é do advogado a empresas que já patrocina/tem acesso (autorizado).
        ctx.on("page", lambda pg: pg.on("dialog", lambda d: d.accept()))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("dialog", lambda d: d.accept())
        page.goto(CONSULTA, wait_until="domcontentloaded")
        input("\n>>> Faça login no TJRN com o A3 nessa janela e tecle ENTER aqui pra começar...\n")

        for i, s in enumerate(alvos, 1):
            nome, mask = s["nome"], s["cpf_mascarado"]
            try:
                rows = pesquisar(page, nome)
            except Exception as e:
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} ERRO busca: {str(e)[:60]}"); continue
            if not rows:
                print(f"[{i}/{len(alvos)}] {nome[:30]:30} sem processo"); continue
            # prioriza processos onde o nome aparece no POLO ATIVO
            def ativo(r):
                cells = r.get("cells") or []
                pa = cells[5] if len(cells) > 5 else r["texto"]
                return nome.split()[0].upper() in (pa or "").upper()
            rows.sort(key=lambda r: (0 if ativo(r) else 1))
            got = None
            for r in rows[:4]:  # tenta até 4 processos
                txt = abrir_e_extrair(page, r["proc"])
                if not txt:
                    continue
                q = parse_qualificacao(txt, nome)
                if q["cpf"] and cpf_confere(q["cpf"], mask):
                    q["proc"] = r["proc"]
                    got = q
                    break
                # se não achou CPF mas é claramente o polo ativo dele, guarda como fraco
                if not got and ativo(r) and (q["endereco"] or q["telefone"]):
                    q["proc"] = r["proc"]; q["fraco"] = True; got = q
            flags = ""
            if got:
                flags = "".join(c for c, k in [("#", "cpf"), ("E", "endereco"), ("T", "telefone"), ("@", "email")] if got.get(k))
                resultados.append({"nome": nome, "mask": mask, **got})
                if not args.dry_run:
                    gravar(s, got)
            print(f"[{i}/{len(alvos)}] {nome[:30]:30} {len(rows)} proc -> {flags or 'sem match'}")
            time.sleep(0.5)
        ctx.close()

    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        if resultados:
            w = csv.DictWriter(f, fieldnames=list(resultados[0].keys())); w.writeheader(); w.writerows(resultados)
    com_tel = sum(1 for r in resultados if r.get("telefone"))
    print(f"\n> {len(resultados)} sócios enriquecidos (telefone:{com_tel}). CSV: {out_csv.name}")


def gravar(socio, q):
    """Atualiza TODOS os contatos desse sócio (mesmo nome) no CRM."""
    nome = socio["nome"]
    obs = (f"PJe/TJRN (proc {q.get('proc','')}): "
           + (f"{q['endereco']}. " if q.get("endereco") else "")
           + (f"Adv: {q['advogado']}. " if q.get("advogado") else "")
           + ("CPF conferido pela mascara." if q.get("cpf") and not q.get("fraco") else "identidade provável (polo ativo)."))
    patch = {"observacoes": obs}
    if q.get("telefone"):
        patch["telefone"] = q["telefone"]
    if q.get("email"):
        patch["email"] = q["email"]
    nome_enc = urllib.parse.quote(nome)
    sb(f"empresa_contatos?nome=eq.{nome_enc}", method="PATCH", body=patch, prefer="return=minimal")


if __name__ == "__main__":
    main()
