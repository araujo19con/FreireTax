#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Enriquece (RFB via BrasilAPI) todas as empresas vinculadas a uma AÇÃO — puxa
QSA (sócios), telefone e e-mail da Receita e grava em `empresas`. O trigger
derive_contatos_from_rfb materializa os sócios + canais em empresa_contatos.

Mesma lógica do edge `enriquecer-fila` (service-role, sem auth de usuário),
mas direcionada a uma lista de empresas (as de uma ação), não à fila gated.

IMPORTANTE (limite real da RFB): a Receita entrega o NOME do sócio + o
telefone/e-mail GERAL da empresa (switchboard). Ela NÃO tem telefone/e-mail
DIRETO de cada sócio. Contato pessoal do sócio = skiptrace (PJe/A3), DRIVA ou
provider pago. Este script enche sócios + canais da empresa; não inventa o que
a RFB não tem.

Uso:
  . tools\\pje-env.local.ps1
  python tools\\enriquecer_acao.py --acao <acao_id> [--force] [--dry]
  # default: só processa quem não tem RFB ou está com >90 dias.
"""
import os, sys, re, json, time, argparse
import requests

def clean(s): return re.sub(r"\D", "", str(s or ""))

def valid_cnpj(c):
    c = clean(c)
    if len(c) != 14 or len(set(c)) == 1: return False
    def dv(base, w):
        s = sum(int(base[i]) * w[i] for i in range(len(w))); m = s % 11
        return 0 if m < 2 else 11 - m
    d1 = dv(c[:12], [5,4,3,2,9,8,7,6,5,4,3,2])
    d2 = dv(c[:13], [6,5,4,3,2,9,8,7,6,5,4,3,2])
    return d1 == int(c[12]) and d2 == int(c[13])

def map_sit(d):
    if not d: return None
    s = d.upper()
    for k in ("ATIVA","BAIXADA","SUSPENSA","INAPTA","NULA"):
        if k in s: return k
    return None

def map_porte(d):
    s = (d or "").upper()
    if "MICROEMPREEND" in s or s == "MEI": return "MEI"
    if "MICRO" in s or s == "ME": return "ME"
    if "PEQUENO" in s or s == "EPP": return "EPP"
    if any(x in s for x in ("DEMAIS","GRANDE","MEDIO")): return "DEMAIS"
    return "NAO_INFORMADO"

def norm_phones(*raw):
    out = []
    for p in raw:
        d = clean(p)
        if (len(d) in (12,13)) and d.startswith("55"): d = d[2:]
        if len(d) in (10,11) and len(set(d)) > 1: out.append(d)
    return sorted(set(out))

def normalize(raw):
    """Espelha normalizeForDB do enriquecer-fila."""
    return {
        "razao_social": raw.get("razao_social"),
        "nome_fantasia": raw.get("nome_fantasia"),
        "data_abertura": raw.get("data_inicio_atividade"),
        "situacao_cadastral": map_sit(raw.get("descricao_situacao_cadastral")),
        "natureza_juridica": raw.get("natureza_juridica"),
        "capital_social": raw.get("capital_social"),
        "porte": map_porte(raw.get("descricao_porte") or raw.get("porte")),
        "opcao_simples": raw.get("opcao_pelo_simples"),
        "data_opcao_simples": raw.get("data_opcao_pelo_simples"),
        "opcao_mei": raw.get("opcao_pelo_mei"),
        "cnae_principal": str(raw["cnae_fiscal"]) if raw.get("cnae_fiscal") is not None else None,
        "cnae_principal_desc": raw.get("cnae_fiscal_descricao"),
        "cnaes_secundarios": raw.get("cnaes_secundarios") or [],
        "logradouro": raw.get("logradouro"),
        "numero_endereco": raw.get("numero"),
        "complemento": raw.get("complemento"),
        "bairro": raw.get("bairro"),
        "municipio": raw.get("municipio"),
        "uf": raw.get("uf"),
        "cep": raw.get("cep"),
        "telefone_receita": raw.get("ddd_telefone_1"),
        "telefones": norm_phones(raw.get("ddd_telefone_1"), raw.get("ddd_telefone_2")),
        "email_receita": raw.get("email"),
        "qsa": [{
            "nome": s.get("nome_socio"), "qualificacao": s.get("qualificacao_socio"),
            "data_entrada": s.get("data_entrada_sociedade"), "documento": s.get("cnpj_cpf_do_socio"),
        } for s in (raw.get("qsa") or [])],
        "receita_atualizada_em": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

def brasilapi(cnpj):
    """BrasilAPI com backoff exponencial no 429 (limite agressivo da API)."""
    for attempt in range(5):
        try:
            r = requests.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}",
                             headers={"Accept": "application/json"}, timeout=30)
            if r.status_code == 429:
                time.sleep(min(2 ** attempt * 2, 30))  # 2,4,8,16,30s
                continue
            if r.status_code == 404: return ("404", None)
            if not r.ok: return (f"http{r.status_code}", None)
            return ("ok", r.json())
        except Exception as e:
            time.sleep(2 ** attempt)
    return ("rate", None)

class Api:
    def __init__(self):
        self.url = os.environ["SUPABASE_URL"].rstrip("/")
        self.key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.h = {"apikey": self.key, "Authorization": f"Bearer {self.key}",
                  "Content-Type": "application/json"}
    def get(self, path, **params):
        r = requests.get(f"{self.url}/rest/v1/{path}", headers=self.h, params=params); r.raise_for_status(); return r.json()
    def patch(self, path, body, **params):
        h = dict(self.h); h["Prefer"] = "return=minimal"
        r = requests.patch(f"{self.url}/rest/v1/{path}", headers=h, params=params, data=json.dumps(body))
        if not r.ok: raise RuntimeError(f"PATCH {path}: {r.status_code} {r.text[:300]}")
    def post(self, path, body):
        h = dict(self.h); h["Prefer"] = "return=minimal"
        requests.post(f"{self.url}/rest/v1/{path}", headers=h, data=json.dumps(body))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acao", required=True)
    ap.add_argument("--force", action="store_true", help="re-enriquece mesmo quem tem RFB fresca")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        sys.exit("ERRO: rode `. tools\\pje-env.local.ps1` antes.")
    api = Api()

    # empresas da ação (via elegibilidade)
    elegs = api.get("elegibilidade", select="empresa_id,empresas(id,cnpj,receita_atualizada_em,email_manual,telefone_manual)",
                    acao_id=f"eq.{args.acao}")
    alvos = []
    for e in elegs:
        emp = e.get("empresas")
        if not emp or not emp.get("cnpj"): continue
        fresh = emp.get("receita_atualizada_em")
        if not args.force and fresh:
            # pula quem tem RFB (independente da idade) — o objetivo é encher os stubs
            continue
        alvos.append(emp)
    print(f"Ação {args.acao}: {len(elegs)} empresas | {len(alvos)} a enriquecer" +
          (" (--force: todas)" if args.force else " (sem RFB)"))
    if args.dry:
        for a in alvos[:10]: print("  ", a["cnpj"])
        print("[DRY] nada gravado."); return

    ok = sem = falha = 0
    for i, emp in enumerate(alvos, 1):
        cnpj = clean(emp["cnpj"])
        if not valid_cnpj(cnpj):
            falha += 1; continue
        status, raw = brasilapi(cnpj)
        if status != "ok":
            if status == "404": sem += 1
            else: falha += 1
            api.post("enriquecimento_log", {"empresa_id": emp["id"], "cnpj": cnpj,
                     "fonte": "brasilapi", "sucesso": False, "erro": status})
            time.sleep(1.5); continue
        payload = normalize(raw)
        if emp.get("email_manual"): payload.pop("email_receita", None)
        if emp.get("telefone_manual"): payload.pop("telefone_receita", None)
        try:
            api.patch("empresas", payload, id=f"eq.{emp['id']}")
            ok += 1
            api.post("enriquecimento_log", {"empresa_id": emp["id"], "cnpj": cnpj,
                     "fonte": "brasilapi", "sucesso": True})
        except RuntimeError as ex:
            falha += 1
            api.post("enriquecimento_log", {"empresa_id": emp["id"], "cnpj": cnpj,
                     "fonte": "brasilapi", "sucesso": False, "erro": str(ex)[:200]})
        if i % 25 == 0:
            print(f"  {i}/{len(alvos)}  ok={ok} sem_dados={sem} falha={falha}")
        time.sleep(1.5)  # rate limit BrasilAPI
    print(f"\nFIM: ok={ok} sem_dados={sem} falha={falha} de {len(alvos)}")

if __name__ == "__main__":
    main()
