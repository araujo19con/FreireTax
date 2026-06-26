import os, re, sys, json, unicodedata, urllib.request, urllib.parse
URL=os.environ["SUPABASE_URL"]; KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WRITE="--write" in sys.argv
def sb(path, method="GET", body=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(f"{URL}/rest/v1/{path}",data=data,method=method,
        headers={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json","Prefer":"return=minimal"})
    r=urllib.request.urlopen(req,timeout=60); 
    return json.load(r) if method=="GET" else None
def sa(s): return "".join(c for c in unicodedata.normalize("NFD",s or "") if unicodedata.category(c)!="Mn")
RE_ADV=re.compile(r"advoc|advogad|\.adv|jurid|\boab\b|procurador|cartorio|\.gov\.br|sindicato|secretaria",re.I)
STOP={"ltda","me","epp","eireli","sa","cia","com","comercio","industria","servicos","servico",
      "empresa","grupo","do","da","de","dos","das","e","ind","com","distribuidora","transportes",
      "construcoes","construcao","representacoes","participacoes","holding","brasil"}
def toks_nome(n):
    return [t for t in re.split(r"[^a-z]+", sa(n).lower()) if len(t)>=3]
def emp_tokens(n):
    return [t for t in re.split(r"[^a-z]+", sa(n).lower()) if len(t)>=4 and t not in STOP]
# puxa contatos skiptrace com email + nome da empresa
rows=sb("empresa_contatos?select=id,nome,email,observacoes,empresa_id,empresas(nome)"
        "&email=not.is.null&or=(observacoes.ilike.*PJe/*,observacoes.ilike.*eproc/*,observacoes.ilike.*Projudi/*)")
keep=[]; remove=[]
for c in rows:
    email=(c["email"] or "").lower(); 
    if "@" not in email: continue
    local,domain=email.split("@",1)
    dcore=domain.split(".")[0]
    emp=(c.get("empresas") or {}).get("nome") or ""
    name_match=any(t in local for t in toks_nome(c["nome"]))
    et=emp_tokens(emp); empcore=re.sub(r"[^a-z]","",sa(emp).lower())
    dom_match = bool(dcore) and (len(dcore)>=4) and ((dcore in empcore and empcore) or any(t in dcore or dcore in t for t in et))
    if name_match or dom_match:
        keep.append((c,email,"nome" if name_match else "empresa"))
    else:
        remove.append((c,email))
print(f"skiptrace c/ email: {len(rows)} | MANTER: {len(keep)} | REMOVER: {len(remove)}")
print("\n--- amostra MANTIDOS ---")
for c,e,why in keep[:12]: print(f"  [{why:7}] {c['nome'][:28]:28} {e}")
print("\n--- amostra REMOVIDOS (prov. advogado) ---")
for c,e in remove[:18]: print(f"  {c['nome'][:28]:28} {e}")
if WRITE:
    n=0
    for c,e in remove:
        obs=c.get("observacoes") or ""
        if "[email removido" not in obs:
            obs=(obs+f" [email removido (prov. advogado): {c['email']}]").strip()
        sb(f"empresa_contatos?id=eq.{c['id']}",method="PATCH",body={"email":None,"observacoes":obs}); n+=1
    print(f"\n>>> {n} e-mails removidos (nulos) + anotados em observacoes.")
else:
    print("\n[dry-run] nada gravado. Rode com --write pra aplicar.")
