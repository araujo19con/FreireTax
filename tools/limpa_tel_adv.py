import os, re, sys, json, unicodedata, urllib.request
from collections import defaultdict
URL=os.environ["SUPABASE_URL"]; KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WRITE="--write" in sys.argv
def sb(p, method="GET", body=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(f"{URL}/rest/v1/{p}",data=data,method=method,
        headers={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json","Prefer":"return=minimal"})
    r=urllib.request.urlopen(req,timeout=90); 
    return json.load(r) if method=="GET" else None
def sa(s): return "".join(c for c in unicodedata.normalize("NFD",s or "") if unicodedata.category(c)!="Mn")
def dig(s): return re.sub(r"\D","",s or "")
def toks(n): return frozenset(t for t in re.split(r"[^a-z]+", sa(n).lower()) if len(t)>=3)
def same(a,b): return a<=b or b<=a   # mesma pessoa: tokens de um ⊆ do outro
rows=sb("empresa_contatos?select=id,nome,telefone,observacoes&telefone=not.is.null"
        "&or=(observacoes.ilike.*PJe/*,observacoes.ilike.*eproc/*,observacoes.ilike.*Projudi/*)")
by=defaultdict(list)
for c in rows:
    d=dig(c["telefone"])
    if len(d) in (10,11): by[d].append(c)
# p/ cada telefone, conta CLUSTERS de pessoa distintos
remove_rows=[]; compart=[]
for d,cs in by.items():
    clusters=[]
    for c in cs:
        tk=toks(c["nome"])
        for cl in clusters:
            if any(same(tk,m) for m in cl): cl.append(tk); break
        else: clusters.append([tk])
    if len(clusters)>=2:   # mesmo número em 2+ pessoas distintas = advogado/escritório
        compart.append((d,len(clusters),cs))
        remove_rows.extend(cs)
print(f"skiptrace c/ telefone: {len(rows)} | numeros: {len(by)}")
print(f"COMPARTILHADOS entre pessoas distintas: {len(compart)} numeros -> {len(remove_rows)} linhas a remover")
print("\n--- amostra ---")
for d,k,cs in sorted(compart,key=lambda x:-x[1])[:12]:
    print(f"  {d}  ({k} pessoas): {', '.join(sorted(set(c['nome'][:18] for c in cs))[:4])}")
if WRITE:
    n=0
    for c in remove_rows:
        obs=c.get("observacoes") or ""
        if "[telefone removido" not in obs:
            obs=(obs+f" [telefone removido (compartilhado/adv): {c['telefone']}]").strip()
        sb(f"empresa_contatos?id=eq.{c['id']}",method="PATCH",body={"telefone":None,"tipo_telefone":"desconhecido","observacoes":obs}); n+=1
    print(f"\n>>> {n} telefones removidos (compartilhados) + anotados em observacoes.")
else:
    print("\n[dry-run] nada gravado. --write pra aplicar.")
