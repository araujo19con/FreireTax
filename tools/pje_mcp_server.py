# -*- coding: utf-8 -*-
"""MCP server do PJe (Tax Trakker).

Expoe o motor de levantamento de teses (pje_teses_empresa.py) como ferramentas
MCP, para qualquer agente (Claude Code etc.) chamar direto.

Transporte: stdio, JSON-RPC 2.0 na mao (SEM SDK externo — evita problema de
wheels no Python 3.14; zero dependencias alem do que os tools ja usam).

Ferramentas:
  pje_status            -> Chrome CDP vivo? sinal de login A3? (nao faz scraping)
  pje_processos_empresa -> processos/teses ja detectados de um CNPJ (le o CRM)
  pje_relatorio_teses   -> resumo de teses para uma lista de CNPJs (le o CRM)
  pje_detectar_teses    -> roda a deteccao AO VIVO no PJe p/ um CNPJ e grava
  pje_classificar_pdf   -> classifica a tese de uma inicial em PDF (do disco)

Config (Claude Code) — .mcp.json na raiz do projeto:
  { "mcpServers": { "pje": { "command": "python", "args": ["tools/pje_mcp_server.py"] } } }

Credenciais Supabase: carregadas automaticamente do tools/pje-env.local.ps1
(gitignored) se nao estiverem no ambiente.
"""
import sys, os, io, re, json, subprocess, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_env():
    """Popula SUPABASE_URL/SERVICE_ROLE do pje-env.local.ps1 (gitignored) se ausentes."""
    envfile = os.path.join(HERE, "pje-env.local.ps1")
    if os.path.exists(envfile):
        try:
            txt = open(envfile, encoding="utf-8", errors="replace").read()
        except OSError:
            return
        for k, v in re.findall(r"\$env:(\w+)\s*=\s*['\"]([^'\"]+)['\"]", txt):
            os.environ.setdefault(k, v)


_load_env()

# PROTOCOLO: stdout e SO para JSON-RPC, em UTF-8 (no Windows o default e cp1252,
# que quebraria os acentos das teses). stdin tambem em UTF-8. Qualquer print (do
# motor, pypdf, etc.) vai para stderr — senao corromperia o stream do MCP.
_RPC = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", newline="")
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
sys.stdout = sys.stderr

sys.path.insert(0, HERE)
import pje_teses_empresa as M  # usa os.environ p/ creds (carregadas acima)
import pypdf

PORT = int(os.environ.get("PJE_CDP_PORT", "9222"))


# ---------------------------------------------------------------- helpers ----
def _cdp_json(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=4) as r:
        return json.load(r)


def _digits(c):
    return re.sub(r"\D", "", c or "")


def _fmt(d):
    return f"{d[0:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}" if len(d) == 14 else d


def _empresa_por_cnpj(cnpj):
    d = _digits(cnpj)
    if len(d) != 14:
        return None
    pref = f"{d[0:2]}.{d[2:5]}.{d[5:8]}"
    rows = M.sb(f"empresas?select=id,nome,razao_social,cnpj,uf,municipio,teses_status&cnpj=like.{pref}*")
    for r in rows:
        if _digits(r.get("cnpj"))[:8] == d[:8]:
            return r
    return None


# ------------------------------------------------------------------ tools ----
def tool_status(_args):
    try:
        ver = _cdp_json("/json/version")
        tabs = [p.get("url", "") for p in _cdp_json("/json") if p.get("type") == "page"]
    except Exception as e:
        return {"cdp_alive": False, "erro": str(e)[:120],
                "dica": f"Abra o Chrome CDP na porta {PORT} (chrome-cdp.ps1) e faca login A3."}
    return {
        "cdp_alive": True, "chrome": ver.get("Browser"), "abas": tabs,
        "sinal_login_2x": any(("pje1g.trf5" in t or "pje2g.trf5" in t) for t in tabs),
        "sinal_login_1x": any("pje.jf" in t for t in tabs),
        "nota": "Sinal de login e heuristica pela aba aberta; a busca confirma de fato.",
    }


def tool_processos_empresa(args):
    emp = _empresa_por_cnpj(args.get("cnpj", ""))
    if not emp:
        return {"erro": "empresa nao encontrada no CRM para esse CNPJ"}
    procs = M.sb(f"empresa_processos_tributarios?select=numero,grau,orgao,situacao,acao_id,"
                 f"metadados,acoes_tributarias(nome,status)&empresa_id=eq.{emp['id']}&order=numero")
    out = []
    for p in procs:
        md = p.get("metadados") or {}
        if md.get("descartado_manual"):
            continue
        ac = p.get("acoes_tributarias") or {}
        out.append({
            "numero": p["numero"], "grau": p.get("grau"), "orgao": p.get("orgao"),
            "situacao": p.get("situacao"),
            "tese": ac.get("nome") or md.get("tese_manual") or md.get("tese_sugerida"),
            "tese_status_catalogo": ac.get("status"),
            "confirmada": bool(p.get("acao_id")) or bool(md.get("tese_manual")),
            "editado_manual": bool(md.get("editado_manual")),
            "pedido_excerpt": md.get("pedido_excerpt"),
        })
    return {"empresa": emp.get("razao_social") or emp.get("nome"),
            "cnpj": _fmt(_digits(args.get("cnpj"))), "uf": emp.get("uf"),
            "municipio": emp.get("municipio"), "teses_status": emp.get("teses_status"),
            "total_processos": len(out), "processos": out}


def tool_relatorio_teses(args):
    res = []
    for c in (args.get("cnpjs") or []):
        r = tool_processos_empresa({"cnpj": c})
        if "erro" in r:
            res.append({"cnpj": _fmt(_digits(c)), "erro": r["erro"]})
            continue
        teses = sorted({p["tese"] for p in r["processos"] if p["tese"]})
        res.append({"empresa": r["empresa"], "cnpj": r["cnpj"], "n_teses": len(teses), "teses": teses})
    return {"total": len(res), "empresas": res}


def tool_detectar_teses(args):
    d = _digits(args.get("cnpj", ""))
    if len(d) != 14:
        return {"erro": "CNPJ invalido"}
    graus = args.get("graus") or "1gf,1x"
    cmd = [sys.executable, os.path.join(HERE, "pje_teses_empresa.py"),
           "--cnpjs", d, "--graus", graus, "--cdp", "--port", str(PORT), "--gravar"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800,
                           cwd=HERE, env=os.environ)
    except subprocess.TimeoutExpired:
        return {"erro": "timeout (30min) — provavelmente aguardando login A3 no Chrome CDP"}
    out = r.stdout or ""
    if "Timeout aguardando login" in out:
        return {"erro": "sessao A3 nao ativa — faca login no Chrome CDP e tente de novo",
                "saida": out.splitlines()[-6:]}
    return {"ok": r.returncode == 0, "graus": graus,
            "resumo_saida": [l for l in out.splitlines() if l.strip()][-10:],
            "resultado": tool_processos_empresa({"cnpj": d})}


def tool_classificar_pdf(args):
    caminho = args.get("caminho", "")
    if not caminho or not os.path.exists(caminho):
        return {"erro": "arquivo nao encontrado: " + str(caminho)}
    try:
        txt = "\n".join((p.extract_text() or "") for p in pypdf.PdfReader(caminho).pages)
    except Exception as e:
        return {"erro": f"pypdf: {str(e)[:80]}"}
    cat = M.sb("acoes_tributarias?select=id,nome,codigo,status")
    M.TESE_ID = {r["codigo"]: r["id"] for r in cat if r.get("codigo")}
    M.CAT_CODIGOS = set(M.TESE_ID)
    catn = {M._norm(r["nome"]): r["nome"] for r in cat}
    tese, conf, fonte = M.classificar_por_pedidos("", "", catn, txt)
    return {"arquivo": os.path.basename(caminho), "tese": tese, "confianca": conf,
            "fonte": fonte, "peticao_valida": M.peticao_valida(txt),
            "pedido_excerpt": M.trecho_pedidos(txt),
            "pedidos_texto": M.secao_pedidos(txt)[:4000]}


def _datajud_detalhe(numero):
    nd = re.sub(r"\D", "", numero)
    body = json.dumps({"query": {"match": {"numeroProcesso": nd}}}).encode()
    req = urllib.request.Request(
        f"https://api-publica.datajud.cnj.jus.br/{M._datajud_endpoint(numero)}/_search",
        data=body, method="POST",
        headers={"Authorization": f"APIKey {M.DATAJUD_KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode("utf-8"))
    hits = d.get("hits", {}).get("hits", [])
    if not hits:
        return None
    s = hits[0]["_source"]

    def _dt(x):
        x = str(x or "")
        if not x:
            return None
        if "-" in x:  # ISO "2025-09-15T..." (movimentos, ultima atualizacao)
            return x[:10]
        return f"{x[0:4]}-{x[4:6]}-{x[6:8]}" if len(x) >= 8 else None  # compacto "20200807..."

    movs = sorted((s.get("movimentos") or []), key=lambda m: str(m.get("dataHora") or ""), reverse=True)
    return {
        "numero": numero, "tribunal": s.get("tribunal"), "grau": s.get("grau"),
        "classe": (s.get("classe") or {}).get("nome"),
        "assuntos": list(dict.fromkeys(a.get("nome") for a in (s.get("assuntos") or []) if a.get("nome"))),
        "orgao_julgador": (s.get("orgaoJulgador") or {}).get("nome"),
        "data_ajuizamento": _dt(s.get("dataAjuizamento")),
        "valor_causa": s.get("valorCausa"),
        "ultima_atualizacao_datajud": _dt(s.get("dataHoraUltimaAtualizacao")),
        "ultimos_movimentos": [{"data": _dt(m.get("dataHora")), "nome": m.get("nome")} for m in movs[:6]],
    }


def tool_detalhe_processo(args):
    num = (args.get("numero") or "").strip()
    if not re.search(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}", num):
        return {"erro": "numero CNJ invalido (ex.: 0805087-44.2020.4.05.8400)"}
    try:
        det = _datajud_detalhe(num)
    except Exception as e:
        return {"erro": f"DataJud: {str(e)[:100]}"}
    if not det:
        return {"erro": "processo nao encontrado no DataJud (sigiloso ou tribunal fora da API)"}
    return det


def _pje_url(numero, grau):
    """URL da consulta da instancia certa a partir do numero CNJ + grau pedido."""
    if grau in M.GRAUS:
        return M.GRAUS[grau]
    if grau == "1x":
        return M.PJE_1X.get("RN")  # default Secao RN (Oeste/RN)
    if grau == "2x":
        return M.PJE_1X_2G
    # deriva pelo numero: .4.05 = federal TRF5 1o grau (2.x); .8.20 = TJRN
    return "https://pje1g.trf5.jus.br/pje/Processo/ConsultaProcesso/listView.seam"


def tool_processo_autos(args):
    numero = (args.get("numero") or "").strip()
    if not re.search(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}", numero):
        return {"erro": "numero CNJ invalido (ex.: 0805803-32.2024.4.05.8400)"}
    grau = args.get("grau") or "1gf"
    url = _pje_url(numero, grau)
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        return {"erro": f"playwright indisponivel: {str(e)[:80]}"}
    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
        except Exception as e:
            return {"erro": f"CDP indisponivel na porta {PORT} ({str(e)[:60]}). Rode tools/chrome-cdp.ps1 e faca login A3."}
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)
            titulo = page.title()
            # login? PJe nao logado cai em login.seam / /sso/ ou mostra "Bem vindo".
            # (NAO usar "sso" solto: "ConsultaProceSSO" casaria por engano.)
            u, t = (page.url or "").lower(), (titulo or "").lower()
            if ("login.seam" in u or "/sso/" in u or "authorization" in u
                    or "bem vindo" in t or "certificado digital" in t):
                return {"erro": "nao logado A3 nesta instancia", "instancia": url, "titulo": titulo}
            # PJe 2.x (listView): numero CNJ SEGMENTADO em 6 campos fPP:numeroProcesso:*
            mm = re.match(r"(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})", numero)
            seg = {"numeroSequencial": mm.group(1), "numeroDigitoVerificador": mm.group(2),
                   "Ano": mm.group(3), "ramoJustica": mm.group(4),
                   "respectivoTribunal": mm.group(5), "NumeroOrgaoJustica": mm.group(6)}
            achou = True
            for k, v in seg.items():
                el = page.query_selector(f'[id="fPP:numeroProcesso:{k}"]')
                if el:
                    el.fill(v)
                else:
                    achou = False
            if not achou:
                campos = page.evaluate(r"""() => [...document.querySelectorAll('input,select')]
                    .map(e => ({id:e.id||'', type:e.type||e.tagName})).filter(e => e.id)""")
                return {"erro": "campos de numero (fPP:numeroProcesso:*) nao encontrados nesta instancia "
                        "(1.x/terceiros usa outro layout).", "titulo": titulo, "instancia": url,
                        "_debug_campos": campos[:40]}
            page.wait_for_timeout(400)
            btn = page.query_selector('[id="fPP:searchProcessos"]')
            if btn:
                btn.click()
            else:
                page.evaluate(r"""() => { const b=[...document.querySelectorAll('input[type=submit],button')]
                    .find(e => /pesquisar|consultar/i.test((e.value||'')+(e.textContent||''))); if(b) b.click(); }""")
            try:
                M._esperar(page, timeout_s=60)
            except Exception:
                pass
            page.wait_for_timeout(1500)
            # a LINHA de resultado ja traz numero, orgao, autuacao, classe, polo ativo,
            # polo passivo e ultima movimentacao (ordem padrao do 2.x).
            cells = page.evaluate(r"""(num) => {
              const nd = num.replace(/\D/g,'');
              for (const tr of document.querySelectorAll('table tr')) {
                if (tr.querySelector('tr')) continue;
                if (!/\d{7}-\d{2}\.\d{4}/.test(tr.innerText)) continue;
                if (!tr.innerText.replace(/\D/g,'').includes(nd)) continue;
                return [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g,' ').trim()).filter(Boolean);
              }
              return null;
            }""", numero)
            if not cells:
                return {"numero": numero, "instancia": url, "titulo": titulo,
                        "nota": "busca executada, porem 0 linhas para este numero nesta instancia "
                                "(pode estar no 1.x/JFRN ou noutro grau)."}
            i0 = next((i for i, cc in enumerate(cells) if re.search(r"\d{7}-\d{2}\.\d{4}", cc)), 0)
            c = cells[i0:]
            g = lambda i: c[i] if i < len(c) else None
            return {
                "numero": numero, "instancia": url, "fonte": "PJe 2.x (consulta logada A3)",
                "orgao": g(1), "autuado_em": g(2), "classe": g(3),
                "polo_ativo": g(4), "polo_passivo": g(5), "ultima_movimentacao": g(6),
                "_linha_bruta": " | ".join(c),
            }
        except Exception as e:
            return {"erro": f"falha na navegacao PJe: {str(e)[:120]}", "instancia": url}
        finally:
            try:
                page.close()
            except Exception:
                pass


TOOLS = {
    "pje_status": (tool_status,
        "Verifica se o Chrome CDP (scraper PJe) esta vivo e se ha sinal de login A3. Nao faz scraping.",
        {"type": "object", "properties": {}}),
    "pje_processos_empresa": (tool_processos_empresa,
        "Lista os processos tributarios e teses ja detectados de uma empresa (por CNPJ). Le o CRM, sem scraping.",
        {"type": "object", "properties": {"cnpj": {"type": "string", "description": "CNPJ (com ou sem mascara)"}}, "required": ["cnpj"]}),
    "pje_relatorio_teses": (tool_relatorio_teses,
        "Resumo de teses por empresa para uma lista de CNPJs. Le o CRM, sem scraping.",
        {"type": "object", "properties": {"cnpjs": {"type": "array", "items": {"type": "string"}}}, "required": ["cnpjs"]}),
    "pje_detectar_teses": (tool_detectar_teses,
        "Roda a deteccao AO VIVO no PJe (2.x + 1.x) para um CNPJ e grava no CRM. Requer Chrome CDP logado com A3. Retorna as teses detectadas.",
        {"type": "object", "properties": {"cnpj": {"type": "string"}, "graus": {"type": "string", "description": "graus PJe, default '1gf,1x'"}}, "required": ["cnpj"]}),
    "pje_classificar_pdf": (tool_classificar_pdf,
        "Classifica a tese de uma peticao inicial em PDF (caminho no disco) pelos pedidos. Sem scraping.",
        {"type": "object", "properties": {"caminho": {"type": "string"}}, "required": ["caminho"]}),
    "pje_detalhe_processo": (tool_detalhe_processo,
        "Detalhe de UM processo pelo numero CNJ via DataJud/CNJ (publico, SEM login): classe, assuntos, "
        "orgao julgador, data de ajuizamento, valor da causa e ultimos movimentos. Util p/ circularizacao.",
        {"type": "object", "properties": {"numero": {"type": "string", "description": "numero CNJ, ex.: 0805087-44.2020.4.05.8400"}}, "required": ["numero"]}),
    "pje_processo_autos": (tool_processo_autos,
        "Abre o processo DIRETO no PJe logado (Chrome CDP + A3) e extrai dados detalhados: classe, assunto, "
        "orgao, VALOR DA CAUSA, PARTES (polo ativo/passivo) e movimentacao. Vai alem do DataJud (que nao traz "
        "partes). Requer login A3 na instancia. grau: 1gf (TRF5 2.x, default), 2gf, 1g/2g (TJRN), 1x (JFRN 1.x).",
        {"type": "object", "properties": {"numero": {"type": "string"}, "grau": {"type": "string", "description": "1gf|2gf|1g|2g|1x (default 1gf)"}}, "required": ["numero"]}),
}


# --------------------------------------------------------- JSON-RPC stdio ----
def _send(obj):
    _RPC.write(json.dumps(obj, ensure_ascii=False) + "\n")
    _RPC.flush()


def _result(mid, result):
    _send({"jsonrpc": "2.0", "id": mid, "result": result})


def _error(mid, code, msg):
    _send({"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": msg}})


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        mid = msg.get("id")
        method = msg.get("method")
        if method == "initialize":
            _result(mid, {"protocolVersion": "2024-11-05",
                          "capabilities": {"tools": {}},
                          "serverInfo": {"name": "pje", "version": "1.0.0"}})
        elif method in ("notifications/initialized", "initialized"):
            continue  # notificacao — sem resposta
        elif method == "tools/list":
            _result(mid, {"tools": [{"name": n, "description": d, "inputSchema": s}
                                    for n, (f, d, s) in TOOLS.items()]})
        elif method == "tools/call":
            params = msg.get("params") or {}
            name = params.get("name")
            args = params.get("arguments") or {}
            entry = TOOLS.get(name)
            if not entry:
                _error(mid, -32601, f"tool desconhecida: {name}")
                continue
            try:
                res = entry[0](args)
                is_err = isinstance(res, dict) and "erro" in res
                _result(mid, {"content": [{"type": "text",
                              "text": json.dumps(res, ensure_ascii=False, indent=2)}],
                              "isError": is_err})
            except Exception as e:
                _result(mid, {"content": [{"type": "text",
                              "text": json.dumps({"erro": str(e)[:200]}, ensure_ascii=False)}],
                              "isError": True})
        elif mid is not None:
            _error(mid, -32601, f"metodo nao suportado: {method}")


if __name__ == "__main__":
    main()
