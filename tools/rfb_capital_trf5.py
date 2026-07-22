# -*- coding: utf-8 -*-
"""Empresas dos estados do TRF5 com capital social alto -> CRM, com contatos.

FONTE: dump mensal de CNPJ da Receita (tools/rfb_download.py). Tudo oficial e
gratuito — capital social vem do arquivo Empresas, endereço/telefone/e-mail do
Estabelecimentos, decisores do Socios, regime do Simples.

FILTRO: capital >= --min-capital (default R$ 5.000.000) · UF em RN/PB/PE/AL/SE/CE
· MATRIZ · situação ATIVA · natureza jurídica NÃO-pública (exclui 1xxx: órgãos,
autarquias, fundos públicos — têm "capital" alto e não são cliente).

CONTATOS (mesmas convenções do import-driva-contatos.mjs — dedup_key estável,
re-rodar não duplica):
  - sócios PF        -> papel 'socio', cargo = qualificação, dedup socio:<nome>
  - telefone 1/2 RFB -> canal 'geral', fixo/móvel, dedup tel:<dígitos>
  - e-mail RFB       -> canal 'geral', dedup email:<lower>
O melhor sócio (administrador > diretor/presidente > demais) vira PRINCIPAL.

USO (2 fases — a 1ª é pesada e roda uma vez; a 2ª é re-executável):
  python tools/rfb_capital_trf5.py --fase filtrar --dump C:\\rfb-dump
  . tools\\pje-env.local.ps1
  python tools/rfb_capital_trf5.py --fase gravar --dump C:\\rfb-dump [--dry-run]
"""
import io
import os
import re
import sys
import csv
import json
import glob
import time
import zipfile
import argparse
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
csv.field_size_limit(10_000_000)

UFS_TRF5 = {"RN", "PB", "PE", "AL", "SE", "CE"}
FAIXA_ETARIA = {"1": "0-12", "2": "13-20", "3": "21-30", "4": "31-40",
                "5": "41-50", "6": "51-60", "7": "61-70", "8": "71-80", "9": "80+"}
# qualificação do sócio -> prioridade pra escolher o contato PRINCIPAL
QUALIF_PRIORIDADE = {"16": 0, "10": 1, "05": 2, "49": 3, "19": 4, "22": 9, "20": 9}
PORTE = {"01": "ME", "03": "EPP", "05": "DEMAIS"}


def linhas_zip(caminho):
    """Itera linhas CSV (latin-1, ';', com aspas) de todos os membros do zip."""
    with zipfile.ZipFile(caminho) as z:
        for nome in z.namelist():
            with z.open(nome) as fh:
                txt = io.TextIOWrapper(fh, encoding="latin-1", newline="")
                yield from csv.reader(txt, delimiter=";", quotechar='"')


def _digits(s):
    return re.sub(r"\D", "", s or "")


def _data(s):
    s = (s or "").strip()
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s != "00000000" else None


def _tel(ddd, num):
    d, n = _digits(ddd), _digits(num)
    if len(d) != 2 or len(n) < 8 or set(n) == {"0"}:
        return None, None, None
    fmt = f"({d}) {n[:-4]}-{n[-4:]}"
    tipo = "movel" if len(n) == 9 and n[0] == "9" else "fixo"
    return d + n, fmt, tipo


def _mask_cnpj(d):
    return f"{d[0:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}"


def _lookup(dump, nome):
    """Municipios/Naturezas/Qualificacoes/Cnaes: zips de 2 colunas cod;descricao."""
    out = {}
    for cam in glob.glob(os.path.join(dump, nome)):
        for row in linhas_zip(cam):
            if len(row) >= 2:
                out[row[0].strip()] = row[1].strip()
    return out


# ---------------------------------------------------------------------------
# FASE 1 — filtrar (pesada, offline, uma vez)
# ---------------------------------------------------------------------------
def fase_filtrar(dump, min_capital, ufs, saida):
    t0 = time.time()
    print(f"[1/4] Empresas*.zip — capital >= {min_capital:,.0f} e natureza privada")
    alvo = {}   # basico -> dict
    lidos = 0
    for cam in sorted(glob.glob(os.path.join(dump, "Empresas*.zip"))):
        print("   ", os.path.basename(cam))
        for row in linhas_zip(cam):
            lidos += 1
            if len(row) < 6:
                continue
            natureza = row[2].strip()
            if natureza.startswith("1"):        # administração pública
                continue
            try:
                capital = float(row[4].replace(",", "."))
            except ValueError:
                continue
            if capital < min_capital:
                continue
            alvo[row[0].strip()] = {
                "razao": row[1].strip(), "natureza": natureza,
                "capital": capital, "porte": PORTE.get(row[5].strip()),
            }
    print(f"    {lidos:,} lidas -> {len(alvo):,} com capital alto (Brasil)")

    print(f"[2/4] Estabelecimentos*.zip — matriz ATIVA em {'/'.join(sorted(ufs))}")
    matched = {}
    for cam in sorted(glob.glob(os.path.join(dump, "Estabelecimentos*.zip"))):
        print("   ", os.path.basename(cam))
        for row in linhas_zip(cam):
            if len(row) < 28:
                continue
            basico = row[0].strip()
            if basico not in alvo:
                continue
            if row[3].strip() != "1" or row[5].strip() != "02":
                continue
            if row[19].strip().upper() not in ufs:
                continue
            e = alvo[basico]
            t1_raw, t1_fmt, t1_tipo = _tel(row[21], row[22])
            t2_raw, t2_fmt, t2_tipo = _tel(row[23], row[24])
            matched[basico] = {
                **e,
                "cnpj": basico + row[1].strip() + row[2].strip(),
                "fantasia": row[4].strip() or None,
                "abertura": _data(row[10]),
                "cnae": row[11].strip(),
                "logradouro": (row[13].strip() + " " + row[14].strip()).strip() or None,
                "numero": row[15].strip() or None,
                "complemento": row[16].strip() or None,
                "bairro": row[17].strip() or None,
                "cep": _digits(row[18]) or None,
                "uf": row[19].strip().upper(),
                "municipio_cod": row[20].strip(),
                "tel1": (t1_raw, t1_fmt, t1_tipo), "tel2": (t2_raw, t2_fmt, t2_tipo),
                "email": (row[27].strip().lower() or None),
                "socios": [], "simples": None, "mei": None,
            }
    print(f"    {len(matched):,} matrizes ativas no TRF5")

    print("[3/4] Socios*.zip — decisores das selecionadas")
    n_soc = 0
    for cam in sorted(glob.glob(os.path.join(dump, "Socios*.zip"))):
        print("   ", os.path.basename(cam))
        for row in linhas_zip(cam):
            if len(row) < 11:
                continue
            basico = row[0].strip()
            m = matched.get(basico)
            if m is None or row[1].strip() != "2":     # só pessoa FÍSICA
                continue
            m["socios"].append({"nome": row[2].strip(), "doc": row[3].strip(),
                                "qualif": row[4].strip(),
                                "faixa": FAIXA_ETARIA.get(row[10].strip())})
            n_soc += 1
    print(f"    {n_soc:,} sócio(s) PF")

    print("[4/4] Simples.zip — regime")
    for cam in glob.glob(os.path.join(dump, "Simples.zip")):
        for row in linhas_zip(cam):
            if len(row) < 5:
                continue
            m = matched.get(row[0].strip())
            if m is not None:
                m["simples"] = row[1].strip() == "S"
                m["mei"] = row[4].strip() == "S"

    municipios = _lookup(dump, "Municipios.zip")
    naturezas = _lookup(dump, "Naturezas.zip")
    qualifs = _lookup(dump, "Qualificacoes.zip")
    cnaes = _lookup(dump, "Cnaes.zip")
    for m in matched.values():
        m["municipio"] = municipios.get(m.pop("municipio_cod"), None)
        m["natureza_desc"] = naturezas.get(m["natureza"], m["natureza"])
        m["cnae_desc"] = cnaes.get(m["cnae"], None)
        for s in m["socios"]:
            s["cargo"] = qualifs.get(s["qualif"], None)

    with open(saida, "w", encoding="utf-8") as fh:
        json.dump(matched, fh, ensure_ascii=False)
    por_uf = {}
    for m in matched.values():
        por_uf[m["uf"]] = por_uf.get(m["uf"], 0) + 1
    print(f"\nsalvo em {saida}  ({time.time()-t0:.0f}s)")
    print("por UF:", dict(sorted(por_uf.items())))


# ---------------------------------------------------------------------------
# FASE 2 — gravar no Supabase (re-executável; dedup por CNPJ e dedup_key)
# ---------------------------------------------------------------------------
def _sb(url, key, path, method="GET", body=None, prefer="return=representation"):
    req = urllib.request.Request(f"{url}/rest/v1/{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": key, "Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json",
                                          "Prefer": prefer})
    t = urllib.request.urlopen(req, timeout=120).read().decode()
    return json.loads(t) if t.strip() else []


def fase_gravar(saida, dry, so_uf=None, limite=None):
    URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not URL or not KEY:
        sys.exit("ERRO: rode `. tools\\pje-env.local.ps1` antes da fase gravar.")
    with open(saida, encoding="utf-8") as fh:
        matched = json.load(fh)
    regs = list(matched.values())
    if so_uf:
        regs = [m for m in regs if m["uf"] in {u.strip().upper() for u in so_uf.split(",")}]
    regs.sort(key=lambda m: -m["capital"])
    if limite:
        regs = regs[:limite]

    OWNER = _sb(URL, KEY, "profiles?select=id&limit=1")[0]["id"]

    # CNPJs já no CRM (dígitos) — não sobrescreve cadastro existente
    existentes = {}
    off = 0
    while True:
        page = _sb(URL, KEY, f"empresas?select=id,cnpj&cnpj=not.is.null&limit=1000&offset={off}")
        for e in page:
            existentes[_digits(e["cnpj"])] = e["id"]
        if len(page) < 1000:
            break
        off += 1000
    novos = [m for m in regs if _digits(m["cnpj"]) not in existentes]
    ja = len(regs) - len(novos)
    print(f"{len(regs)} selecionadas · {ja} já no CRM (mantidas) · {len(novos)} novas")
    if dry:
        for m in novos[:15]:
            print(f"   + {m['razao'][:52]:<52} {_mask_cnpj(m['cnpj'])} {m['uf']} "
                  f"cap {m['capital']:,.0f}  socios={len(m['socios'])}")
        print(f"   ... (+{max(0, len(novos)-15)})  [DRY-RUN — nada gravado]")
        return

    # ---- empresas ----
    for i in range(0, len(novos), 200):
        chunk = [{
            "nome": m["razao"], "razao_social": m["razao"],
            "nome_fantasia": m["fantasia"], "cnpj": _mask_cnpj(m["cnpj"]),
            "uf": m["uf"], "municipio": m["municipio"],
            "situacao_cadastral": "ATIVA", "porte": m["porte"],
            "capital_social": m["capital"],
            "natureza_juridica": m["natureza_desc"],
            "cnae_principal": m["cnae"], "cnae_principal_desc": m["cnae_desc"],
            "data_abertura": m["abertura"],
            "logradouro": m["logradouro"], "numero_endereco": m["numero"],
            "complemento": m["complemento"], "bairro": m["bairro"],
            "cep": m["cep"],
            "telefone_receita": (m["tel1"][0] or m["tel2"][0]),
            "email_receita": m["email"],
            "opcao_simples": m["simples"], "opcao_mei": m["mei"],
            "qsa": [{"nome_socio": s["nome"], "qualificacao_socio": s["cargo"],
                     "faixa_etaria": s["faixa"]} for s in m["socios"]] or None,
            "status": "prospect", "user_id": OWNER, "responsavel_id": OWNER,
            "receita_atualizada_em": None,
            "metadados": {"origem_cadastro": "rfb-dump-capital",
                          "dump_mes": "2026-07", "capital_minimo": True},
        } for m in novos[i:i + 200]]
        criadas = _sb(URL, KEY, "empresas?on_conflict=cnpj", "POST", chunk,
                      prefer="return=representation,resolution=ignore-duplicates")
        for e in criadas:
            existentes[_digits(e["cnpj"])] = e["id"]
        print(f"  empresas {i + len(chunk)}/{len(novos)}")

    # ---- contatos (novas E existentes — o dedup_key impede duplicar) ----
    ids_alvo = [existentes[_digits(m["cnpj"])] for m in regs
                if _digits(m["cnpj"]) in existentes]
    ja_keys = set()
    for i in range(0, len(ids_alvo), 60):
        lote = ",".join(ids_alvo[i:i + 60])
        for c in _sb(URL, KEY, "empresa_contatos?select=empresa_id,dedup_key"
                               f"&empresa_id=in.({lote})&limit=10000"):
            ja_keys.add((c["empresa_id"], c.get("dedup_key")))

    def norm(s):
        import unicodedata
        s = unicodedata.normalize("NFD", (s or "").lower())
        return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip()

    linhas, n_socios, n_canais = [], 0, 0
    for m in regs:
        eid = existentes.get(_digits(m["cnpj"]))
        if not eid:
            continue
        cands = sorted(m["socios"],
                       key=lambda s: QUALIF_PRIORIDADE.get(s["qualif"], 8))
        for pos, s in enumerate(cands):
            key = f"socio:{norm(s['nome'])}"
            if (eid, key) in ja_keys or not s["nome"]:
                continue
            ja_keys.add((eid, key))
            n_socios += 1
            linhas.append({"empresa_id": eid, "nome": s["nome"], "cargo": s["cargo"],
                           "papel": "socio", "cpf_mascarado": s["doc"] or None,
                           "faixa_etaria": s["faixa"], "origem": "rfb",
                           "principal": pos == 0, "dedup_key": key})
        for t in (m["tel1"], m["tel2"]):
            raw, fmt, tipo = t
            if not raw:
                continue
            key = f"tel:{raw}"
            if (eid, key) in ja_keys:
                continue
            ja_keys.add((eid, key))
            n_canais += 1
            linhas.append({"empresa_id": eid, "telefone": fmt, "tipo_telefone": tipo,
                           "whatsapp": tipo == "movel", "papel": "geral",
                           "origem": "rfb", "dedup_key": key})
        if m["email"]:
            key = f"email:{m['email']}"
            if (eid, key) not in ja_keys:
                ja_keys.add((eid, key))
                n_canais += 1
                linhas.append({"empresa_id": eid, "email": m["email"],
                               "papel": "geral", "origem": "rfb", "dedup_key": key})

    for i in range(0, len(linhas), 500):
        _sb(URL, KEY, "empresa_contatos", "POST", linhas[i:i + 500],
            prefer="return=minimal")
        print(f"  contatos {min(i + 500, len(linhas))}/{len(linhas)}")
    print(f"\nFEITO: {len(novos)} empresa(s) nova(s) · {n_socios} sócio(s) · "
          f"{n_canais} canal(is) tel/email")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fase", required=True, choices=["filtrar", "gravar"])
    ap.add_argument("--dump", required=True, help="pasta com os zips da RFB")
    ap.add_argument("--min-capital", type=float, default=5_000_000)
    ap.add_argument("--ufs", default=",".join(sorted(UFS_TRF5)))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--so-uf", help="gravar: restringe a UFs (ex. RN,PB)")
    ap.add_argument("--limite", type=int, help="gravar: só as N maiores por capital")
    a = ap.parse_args()
    saida = os.path.join(a.dump, "trf5_capital.json")
    if a.fase == "filtrar":
        fase_filtrar(a.dump, a.min_capital,
                     {u.strip().upper() for u in a.ufs.split(",")}, saida)
    else:
        fase_gravar(saida, a.dry_run, a.so_uf, a.limite)


if __name__ == "__main__":
    main()
