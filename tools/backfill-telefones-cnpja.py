#!/usr/bin/env python3
"""Backfill de telefone/CELULAR via CNPJa (array tipado) na base existente.

A edge function enriquecer-cnpj prefere BrasilAPI (telefone fixo); o array
tipado do CNPJa (onde vem o celular) só entra em fallback/avulso. Este script
busca o CNPJa DIRETO (5/min, throttled) e mescla os telefones em
empresas.telefones -> o trigger derive_contatos_from_rfb materializa os novos.

Escopo:
  --scope prospects  (default) só empresas no pipeline (prospeccoes/reunioes/tarefas)
  --scope all        toda a base com CNPJ (~5.6k, ~19h a 5/min)
Resumível (ledger cnpja_phone_ledger.json), idempotente, limpa lixo.

  $env:SUPABASE_URL=...; $env:SUPABASE_SERVICE_ROLE_KEY=...
  python tools/backfill-telefones-cnpja.py [--scope prospects|all] [--limit N] [--write]
"""
import os, re, sys, json, time, urllib.request, urllib.error
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL=os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
KEY=os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not URL or not KEY: sys.exit("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.")
WRITE="--write" in sys.argv
SCOPE=(sys.argv[sys.argv.index("--scope")+1] if "--scope" in sys.argv else "prospects")
LIMIT=int(sys.argv[sys.argv.index("--limit")+1]) if "--limit" in sys.argv else 10**9
LEDGER=os.path.join(ROOT,"cnpja_phone_ledger.json")
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
def sb(path, method="GET", body=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(f"{URL}/rest/v1/{path}",data=data,method=method,
        headers={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json","Prefer":"return=minimal"})
    r=urllib.request.urlopen(req,timeout=90)
    return json.load(r) if method=="GET" else None
def clean(s):
    d=re.sub(r"\D","",s or "")
    if len(d) in (12,13) and d.startswith("55"): d=d[2:]
    if len(d) not in (10,11): return None
    if re.fullmatch(r"(\d)\1+",d): return None
    return d
def cnpja(c):
    for _ in range(4):
        try:
            d=json.load(urllib.request.urlopen(urllib.request.Request(
                f"https://open.cnpja.com/office/{c}",headers={"Accept":"application/json","User-Agent":UA}),timeout=30))
            return [f"{p.get('area','')}{p.get('number','')}" for p in (d.get("phones") or [])]
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(14); continue
            return None
        except Exception: return None
    return None
def col(rows,k): return {r[k] for r in rows if r.get(k)}
# escopo
if SCOPE=="all":
    ids=set(); off=0
    while True:
        p=sb(f"empresas?select=id&cnpj=not.is.null&limit=1000&offset={off}")
        if not p: break
        ids|=col(p,"id"); off+=1000
        if len(p)<1000: break
else:
    ids=set()
    for t in ("prospeccoes","reunioes","tarefas"):
        try: ids|=col(sb(f"{t}?select=empresa_id&empresa_id=not.is.null&limit=5000"),"empresa_id")
        except Exception as e: print(f"(aviso: {t}: {str(e)[:40]})")
print(f"escopo={SCOPE}: {len(ids)} empresas")
done=set(json.load(open(LEDGER))) if os.path.exists(LEDGER) else set()
ids=[i for i in ids if i not in done]
# dados das empresas
emp=[]
for i in range(0,len(ids),50):
    chunk="(%s)"%",".join(ids[i:i+50])
    emp+=sb(f"empresas?select=id,nome,cnpj,telefones&id=in.{chunk}")
emp=[e for e in emp if e.get("cnpj")][:LIMIT]
print(f"a processar (sem os já no ledger): {len(emp)}\n")
add_mov=0; upd=0
for n,e in enumerate(emp,1):
    cn=re.sub(r"\D","",e["cnpj"]); 
    if len(cn) in (12,13): cn=cn.zfill(14)
    phs=cnpja(cn)
    done.add(e["id"]); 
    if WRITE: json.dump(list(done),open(LEDGER,"w"))
    if phs is None:
        print(f"[{n}/{len(emp)}] {e['nome'][:30]:30} CNPJa erro/429"); time.sleep(13); continue
    novos=[d for d in (clean(p) for p in phs) if d]
    cur=[clean(x) for x in (e.get("telefones") or [])]; cur=[x for x in cur if x]
    merge=list(dict.fromkeys(cur+novos))
    new_mov=[d for d in novos if d not in cur and len(d)==11]
    if merge!=cur and WRITE:
        sb(f"empresas?id=eq.{e['id']}",method="PATCH",body={"telefones":merge}); upd+=1
    add_mov+=len(new_mov)
    print(f"[{n}/{len(emp)}] {e['nome'][:30]:30} CNPJa={len(novos)} novos_cel={len(new_mov)}")
    time.sleep(13)
print(f"\n>>> {'GRAVADO' if WRITE else 'DRY'}: {upd} empresas atualizadas | ~{add_mov} celulares novos materializados")
