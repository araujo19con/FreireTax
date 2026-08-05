# -*- coding: utf-8 -*-
"""Classifica teses a partir dos PDFs das INICIAIS baixados manualmente.

Motivo: a consulta de TERCEIROS do PJe 1.x esconde os "Documentos de Comprovacao"
(o corpo real da inicial, quando protocolada "em anexo" — Res. TRF5 10/2016). Mas o
usuario, logado, consegue baixar o "DOC 00 - PETICAO INICIAL". Este script le esses
PDFs do disco e classifica pelo OBJETO (pedidos finais), com a mesma logica
peticao-only de pje_teses_empresa.py.

USO:
  . .\\tools\\pje-env.local.ps1                       # p/ --gravar/--arquivar (service key)
  python tools\\classifica_peticoes_disco.py --dir "C:\\Users\\...\\Downloads\\iniciais"
  python tools\\classifica_peticoes_disco.py --dir <pasta> --gravar   # atualiza acao_id no CRM
  python tools\\classifica_peticoes_disco.py --dir <pasta> --arquivar # organiza as iniciais em
                                                                       # <base>/<empresa>/<numero>.pdf

Nome do arquivo OU o texto do PDF deve conter o numero CNJ do processo
(ex.: "0801749-64.2017.4.05.8401"); o script extrai automaticamente.

--arquivar copia cada inicial para uma pasta POR EMPRESA (nome = numero do processo);
processo pertencente a MAIS DE UMA empresa e replicado em todas.
"""
import sys, io, os, re, glob, argparse, shutil
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pje_teses_empresa as M
import pypdf

_NUM_RE = re.compile(r"\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b")
# O PJe carimba "Processo: <numero>" no rodape de assinatura de CADA pagina — esse
# e o numero REAL do autos. Numeros no corpo costumam ser PRECEDENTES citados.
_STAMP_RE = re.compile(r"Processo:\s*(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})")

# caracteres invalidos em nome de pasta no Windows
_INVAL = re.compile(r'[<>:"/\\|?*\r\n\t]+')


def slug_empresa(nome):
    s = _INVAL.sub("", (nome or "").strip()).strip(". ")
    return (s or "SEM_NOME")[:120]


def arquivar_inicial(base, proc, src):
    """Copia a inicial para <base>/<empresa>/<numero>.pdf — uma pasta por empresa;
    processo de MAIS DE UMA empresa e replicado em todas. Casa a(s) empresa(s) pelo
    numero em empresa_processos_tributarios."""
    linhas = M.sb(f"empresa_processos_tributarios?select=empresas(nome,razao_social)&numero=eq.{proc}")
    nomes = []
    for ln in linhas:
        e = ln.get("empresas") or {}
        nome = (e.get("razao_social") or e.get("nome") or "").strip()
        if nome:
            nomes.append(nome)
    nomes = list(dict.fromkeys(nomes)) or ["__sem_empresa__"]
    for nome in nomes:
        pasta = os.path.join(base, slug_empresa(nome))
        os.makedirs(pasta, exist_ok=True)
        dest = os.path.join(pasta, f"{proc}.pdf")
        try:
            shutil.copy2(src, dest)
        except (PermissionError, OSError) as e:
            # PDF aberto no visualizador (WinError 32) etc. — nao aborta o lote
            print(f"    [arq-erro] {slug_empresa(nome)}/{proc}.pdf: {str(e)[:45]} (pulado)")
    return nomes


# CNPJ na peca: 2-3-3-4-2. EXIGE a "/" e o "-" (assinatura do CNPJ) p/ NAO casar
# IDs de documento do PJe (14 digitos crus). Dots/espacos tolerantes porque a
# extracao do PDF quebra/junta ("n.º07.522.026/0001 -49"). SEM \b — o CNPJ costuma
# vir colado no ordinal "nº" e "º" conta como caractere de palavra no Unicode.
_CNPJ_RE = re.compile(r"\d{2}[.\s]{0,2}\d{3}[.\s]{0,2}\d{3}\s*/\s*\d{4}\s*-\s*\d{2}")


def empresas_da_peticao(texto):
    """Empresas AUTORAS da peca: casa os CNPJs citados na inicial com empresas do
    CRM, por RAIZ (8 primeiros digitos) — filiais diferentes contam como a mesma
    empresa. So considera empresas que EXISTEM no CRM; a contraparte (Uniao/Fazenda)
    nao tem CNPJ de cliente, entao raramente da falso-positivo em MS tributario.
    Retorna dict empresa_id -> {nome, cnpj}."""
    raizes = set()
    for m in _CNPJ_RE.findall(texto or ""):
        d = re.sub(r"\D", "", m)
        if len(d) == 14:
            raizes.add(d[:8])
    achadas = {}
    for raiz in raizes:
        pref = f"{raiz[0:2]}.{raiz[2:5]}.{raiz[5:8]}"   # formato do CRM: "12.620.867"
        for r in M.sb(f"empresas?select=id,nome,cnpj&cnpj=like.{pref}*"):
            if re.sub(r"\D", "", r.get("cnpj") or "")[:8] == raiz:
                achadas[r["id"]] = {"nome": r.get("nome"), "cnpj": r.get("cnpj")}
    return achadas


def texto_pdf(path):
    try:
        rd = pypdf.PdfReader(path)
        return "\n".join((p.extract_text() or "") for p in rd.pages)
    except Exception as e:
        print(f"  [erro pypdf] {os.path.basename(path)}: {str(e)[:60]}")
        return ""


def num_processo(texto, fname):
    import collections
    # 1) carimbo de assinatura do PJe (o mais confiavel: e o numero dos autos)
    st = _STAMP_RE.findall(texto)
    if st:
        return collections.Counter(st).most_common(1)[0][0]
    # 2) numero MAIS FREQUENTE no texto (o real se repete; citacao aparece 1x)
    nums = _NUM_RE.findall(texto)
    if nums:
        return collections.Counter(nums).most_common(1)[0][0]
    # 3) fallback: nome do arquivo
    m = _NUM_RE.search(fname.replace("_", ""))
    return m.group(1) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="pasta com os PDFs das iniciais")
    ap.add_argument("--gravar", action="store_true",
                    help="atualiza acao_id em empresa_processos_tributarios (casa por numero)")
    ap.add_argument("--arquivar", nargs="?", const="__AUTO__", default=None,
                    help="arquiva cada inicial em <base>/<empresa>/<numero>.pdf (uma pasta por "
                         "empresa; processo de varias empresas vai em TODAS). Sem valor: usa "
                         "<projeto>/'teses iniciais' (gitignored)")
    a = ap.parse_args()

    tem_banco = bool(M.SUPABASE_URL and M.SERVICE_KEY)
    if a.gravar and not tem_banco:
        sys.exit("--gravar exige env: rode `. .\\tools\\pje-env.local.ps1` antes.")
    arquivar_base = None
    if a.arquivar is not None:
        if not tem_banco:
            sys.exit("--arquivar exige env (precisa achar a empresa de cada numero).")
        # default = <raiz do projeto>/"teses iniciais" (HERE = tools/); esse
        # caminho esta no .gitignore (iniciais de clientes nao vao pro repo).
        arquivar_base = (a.arquivar if a.arquivar != "__AUTO__"
                         else os.path.normpath(os.path.join(HERE, "..", "teses iniciais")))

    if tem_banco:
        # DETECCAO = fato historico: reconhece qualquer tese do catalogo (ativa ou nao).
        cat = M.sb("acoes_tributarias?select=id,nome,codigo,status")
        M.TESE_ID = {r["codigo"]: r["id"] for r in cat if r.get("codigo")}
        M.CAT_CODIGOS = set(M.TESE_ID)
        catalogo_norm = {M._norm(r["nome"]): r["nome"] for r in cat}
        print(f"catalogo: {len(cat)} teses ({len(M.CAT_CODIGOS)} com codigo)")
    else:
        M.CAT_CODIGOS = set(M.TESE_CODIGO.values())  # sem banco: so relatorio
        catalogo_norm = {}
        print("[sem env] modo relatorio — nao grava; todas as regras habilitadas")

    pdfs = sorted(glob.glob(os.path.join(a.dir, "*.pdf")))
    if not pdfs:
        sys.exit(f"nenhum PDF em {a.dir}")
    print(f"{len(pdfs)} PDF(s)\n" + "=" * 78)

    resultados = []
    for f in pdfs:
        txt = texto_pdf(f)
        proc = num_processo(txt, os.path.basename(f))
        valida = M.peticao_valida(txt)
        tese, conf, fonte = M.classificar_por_pedidos("", "", catalogo_norm, txt)
        ped = M.trecho_pedidos(txt)                       # trecho curto (card recolhido)
        sec = M.secao_pedidos(txt)                        # seção INTEIRA (ao expandir)
        print(f"\n{os.path.basename(f)}")
        print(f"  processo: {proc or '??'} | {len(txt)} chars | peticao_valida={valida}")
        print(f"  => TESE: {(tese or 'NENHUMA do catalogo').strip()}  [fonte: {fonte}, conf: {conf}]")
        if ped:
            print(f"  pedidos: {ped[:260]}")
        # co-autoras: quais empresas do CRM constam como autoras (pelos CNPJs da peca)
        emp = empresas_da_peticao(txt) if tem_banco else {}
        if len(emp) > 1:
            print(f"  autoras (CNPJ): {', '.join(sorted(v['nome'] for v in emp.values()))}")
        resultados.append((proc, tese, fonte, f, ped, sec, emp))  # f = caminho COMPLETO

    if a.gravar:
        print("\n" + "=" * 78 + "\nGRAVANDO (vincula TODAS as empresas autoras da peca):")
        for proc, tese, fonte, src, ped, sec, emp in resultados:
            if not proc:
                print(f"  [pulado] {os.path.basename(src)}: sem numero de processo"); continue
            # linhas ja existentes desse numero (qualquer empresa) — servem de template
            # (grau/classe/orgao) e trazem os flags manuais por empresa.
            existentes = M.sb(f"empresa_processos_tributarios?select=empresa_id,acao_id,grau,"
                              f"classe,orgao,situacao,assunto,metadados&numero=eq.{proc}")
            por_emp = {r["empresa_id"]: r for r in existentes}
            # ALVOS = autoras detectadas na peca (CNPJ) UNIAO com as ja vinculadas
            alvos = set(emp) | set(por_emp)
            if not alvos:
                print(f"  [ausente] {proc}: nenhum CNPJ da peca bate com empresa do CRM")
                continue
            # TESE autoritativa do processo: se JA existe linha manual (editado/
            # tese_manual) — inclusive uma correcao a mao — ela manda; as co-autoras
            # novas ESPELHAM (mesma peca = mesma tese, mesmo acao_id/rotulo). Senao,
            # usa a classificacao automatica desta rodada.
            manuais = [r for r in existentes
                       if (r.get("metadados") or {}).get("editado_manual")
                       or (r.get("metadados") or {}).get("tese_manual")]
            aut = manuais[0] if manuais else None
            if aut:
                novo_acao = aut.get("acao_id")
                novo_md = dict(aut.get("metadados") or {})   # herda rotulo + flags manuais
            else:
                novo_acao = M.TESE_ID.get(M.tese_codigo(tese)) if tese else None
                novo_md = {}
                if novo_acao is None:
                    novo_md["tese_sugerida"] = (tese or "").strip() or "objeto fora do catálogo (ver pedido_excerpt)"
            # pedidos SEMPRE frescos (extracao melhor) + rastro do arquivo
            novo_md.update({"pedido_excerpt": ped, "pedidos_texto": sec,
                            "fonte_classificacao": f"inicial_disco:{fonte}",
                            "arquivo": os.path.basename(src)})
            tmpl = existentes[0] if existentes else {}
            body, pulados = [], 0
            for eid in alvos:
                atual = (por_emp.get(eid) or {}).get("metadados") or {}
                # respeita edicao/exclusao manual POR EMPRESA (nao sobrescreve)
                if (atual.get("descartado_manual") or atual.get("editado_manual")
                        or atual.get("tese_manual")):
                    pulados += 1; continue
                molde = por_emp.get(eid) or tmpl
                body.append({
                    "empresa_id": eid, "numero": proc, "polo": "ativo", "fonte": "inicial_disco",
                    "grau": molde.get("grau") or "1gf", "classe": molde.get("classe"),
                    "orgao": molde.get("orgao"), "situacao": molde.get("situacao"),
                    "assunto": molde.get("assunto"), "acao_id": novo_acao, "metadados": novo_md,
                })
            if body:
                M.sb_upsert("empresa_processos_tributarios", body, "empresa_id,numero")
            nota = ("(espelha tese manual existente)" if aut
                    else (f"-> {tese.strip()[:38]}" if novo_acao else "(sem crava)"))
            extra = f", {pulados} manual(is) preservada(s)" if pulados else ""
            print(f"  [OK] {proc} {nota} | {len(body)} nova(s)/atualizada(s){extra}")

    if arquivar_base:
        print("\n" + "=" * 78 + f"\nARQUIVANDO iniciais por empresa em: {arquivar_base}")
        for proc, tese, fonte, src, ped, sec, emp in resultados:
            if not proc:
                print(f"  [pulado] {os.path.basename(src)}: sem numero de processo"); continue
            nomes = arquivar_inicial(arquivar_base, proc, src)
            print(f"  [arq] {proc}.pdf -> {', '.join(slug_empresa(n) for n in nomes)}")


if __name__ == "__main__":
    main()
