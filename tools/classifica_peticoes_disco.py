# -*- coding: utf-8 -*-
"""Classifica teses a partir dos PDFs das INICIAIS baixados manualmente.

Motivo: a consulta de TERCEIROS do PJe 1.x esconde os "Documentos de Comprovacao"
(o corpo real da inicial, quando protocolada "em anexo" — Res. TRF5 10/2016). Mas o
usuario, logado, consegue baixar o "DOC 00 - PETICAO INICIAL". Este script le esses
PDFs do disco e classifica pelo OBJETO (pedidos finais), com a mesma logica
peticao-only de pje_teses_empresa.py.

USO:
  . .\\tools\\pje-env.local.ps1                       # p/ --gravar (usa service key)
  python tools\\classifica_peticoes_disco.py --dir "C:\\Users\\...\\Downloads\\iniciais"
  python tools\\classifica_peticoes_disco.py --dir <pasta> --gravar   # atualiza acao_id no CRM

Nome do arquivo OU o texto do PDF deve conter o numero CNJ do processo
(ex.: "0801749-64.2017.4.05.8401"); o script extrai automaticamente.
"""
import sys, io, os, re, glob, argparse
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pje_teses_empresa as M
import pypdf

_NUM_RE = re.compile(r"\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b")
# O PJe carimba "Processo: <numero>" no rodape de assinatura de CADA pagina — esse
# e o numero REAL do autos. Numeros no corpo costumam ser PRECEDENTES citados.
_STAMP_RE = re.compile(r"Processo:\s*(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})")


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
    a = ap.parse_args()

    tem_banco = bool(M.SUPABASE_URL and M.SERVICE_KEY)
    if a.gravar and not tem_banco:
        sys.exit("--gravar exige env: rode `. .\\tools\\pje-env.local.ps1` antes.")

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
        resultados.append((proc, tese, fonte, os.path.basename(f), ped, sec))

    if a.gravar:
        print("\n" + "=" * 78 + "\nGRAVANDO (casa por numero em empresa_processos_tributarios):")
        for proc, tese, fonte, fname, ped, sec in resultados:
            if not proc:
                print(f"  [pulado] {fname}: sem numero de processo"); continue
            existe = M.sb(f"empresa_processos_tributarios?select=numero,empresa_id,metadados&numero=eq.{proc}")
            if not existe:
                print(f"  [ausente] {proc}: nao esta no CRM (cadastre a empresa/rode a deteccao antes)")
                continue
            md_atual = existe[0].get("metadados") or {}
            if md_atual.get("editado_manual") or md_atual.get("tese_manual"):
                print(f"  [manual] {proc}: tese editada a mao no card — nao sobrescreve")
                continue
            acao_id = M.TESE_ID.get(M.tese_codigo(tese)) if tese else None
            # trecho curto + SEÇÃO INTEIRA de pedidos vão pro metadados (card do processo)
            md = {"pedido_excerpt": ped, "pedidos_texto": sec,
                  "fonte_classificacao": f"inicial_disco:{fonte}", "arquivo": fname}
            if acao_id is None:
                md["tese_sugerida"] = (tese or "").strip() or "objeto fora do catálogo (ver pedido_excerpt)"
            M.sb_patch(f"empresa_processos_tributarios?numero=eq.{proc}",
                       {"acao_id": acao_id, "metadados": md})
            nota = f"-> {tese.strip()[:45]}" if acao_id else "(sem crava; trecho gravado)"
            print(f"  [OK] {proc} {nota}")


if __name__ == "__main__":
    main()
