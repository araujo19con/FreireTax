# -*- coding: utf-8 -*-
"""Verificador de DRIFT de schema — compara os objetos DEFINIDOS nas migrations
(git) com o que EXISTE de fato no banco. Pega "fantasmas" do repair de histórico
(migration marcada como aplicada mas cujo SQL nunca rodou) — foi o que deixou a
auditoria parada e as páginas Financeiro/Prazos quebradas (ago/2026).

Rode ANTES de cada deploy / em CI. Sai com código != 0 se houver gap real
(tabela/coluna/enum/trigger/função/índice ausente, ou tabela com RLS ligado sem
NENHUMA policy). Policies renomeadas (refactor de RLS) contam como INFO, não falha.

Credencial: usa a Management API (introspecção do catálogo, que o PostgREST não
expõe). Defina um Personal Access Token:
  PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
  bash:        export SUPABASE_ACCESS_TOKEN="sbp_..."
(Gere/rotacione em Supabase → Account → Access Tokens.)

Uso:
  python tools/check_schema_drift.py
  python tools/check_schema_drift.py --project-ref <ref>   # default: supabase/.temp/project-ref
"""
import sys, io, os, re, json, glob, argparse, urllib.request, urllib.error
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
MIG_DIR = os.path.join(os.path.dirname(HERE), "supabase", "migrations")
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN") or os.environ.get("SUPA_TOKEN")


def _ref(cli_ref):
    if cli_ref:
        return cli_ref
    f = os.path.join(os.path.dirname(HERE), "supabase", ".temp", "project-ref")
    return open(f, encoding="utf-8").read().strip() if os.path.exists(f) else ""


def q(ref, sql):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": sql}).encode(), method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json",
                 "User-Agent": "curl/8.4.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


# ---------- parse das migrations ----------
def parse_migrations():
    text = "\n".join(open(f, encoding="utf-8").read() for f in sorted(glob.glob(os.path.join(MIG_DIR, "*.sql"))))

    def find(pat):
        return set(m.strip().lower() for m in re.findall(pat, text, re.I))

    tables = find(r"create table (?:if not exists )?(?:public\.)?(\w+)") - \
        find(r"drop table (?:if exists )?(?:public\.)?(\w+)")
    types = find(r"create type (?:public\.)?(\w+)") - \
        find(r"drop type (?:if exists )?(?:public\.)?(\w+)")
    trigs = find(r"create trigger (\w+)")
    idx = find(r"create (?:unique )?index (?:concurrently )?(?:if not exists )?(\w+)")
    fns = find(r"create (?:or replace )?function (?:public\.)?(\w+)")

    cols, dropcols = set(), set()
    for am in re.finditer(r"alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)(.*?);", text, re.I | re.S):
        tbl, body = am.group(1).lower(), am.group(2)
        for cm in re.finditer(r"add column (?:if not exists )?(\w+)", body, re.I):
            cols.add((tbl, cm.group(1).lower()))
        for cm in re.finditer(r"drop column (?:if exists )?(\w+)", body, re.I):
            dropcols.add((tbl, cm.group(1).lower()))
    cols -= dropcols

    pols, droppols = set(), set()
    for m in re.finditer(r'create policy\s+"?([^"\n]+?)"?\s+on\s+(?:public\.)?(\w+)', text, re.I):
        pols.add((m.group(1).strip().lower(), m.group(2).strip().lower()))
    for m in re.finditer(r'drop policy\s+(?:if exists\s+)?"?([^"\n]+?)"?\s+on\s+(?:public\.)?(\w+)', text, re.I):
        droppols.add((m.group(1).strip().lower(), m.group(2).strip().lower()))
    pols -= droppols
    return dict(tables=tables, types=types, trigs=trigs, idx=idx, fns=fns, cols=cols, pols=pols)


def db_state(ref):
    g = lambda sql, k: {r[k] for r in q(ref, sql)}
    return dict(
        tables=g("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'", "table_name"),
        types=g("select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'", "typname"),
        trigs=g("select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and not t.tgisinternal", "tgname"),
        idx=g("select indexname from pg_indexes where schemaname='public'", "indexname"),
        fns=g("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'", "proname"),
        cols={(r["table_name"], r["column_name"]) for r in q(ref, "select table_name, column_name from information_schema.columns where table_schema='public'")},
        pols={(r["policyname"].lower(), r["tablename"].lower()) for r in q(ref, "select policyname, tablename from pg_policies where schemaname='public'")},
        # tabelas com RLS ligado e ZERO policies (lockout/exposição real)
        rls_zero=[r["relname"] for r in q(ref, """
            select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r' and c.relrowsecurity
              and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname)""")],
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-ref")
    a = ap.parse_args()
    if not TOKEN:
        sys.exit("Defina SUPABASE_ACCESS_TOKEN (Supabase → Account → Access Tokens).")
    ref = _ref(a.project_ref)
    if not ref:
        sys.exit("Project ref não encontrado (passe --project-ref).")

    try:
        mig, db = parse_migrations(), db_state(ref)
    except urllib.error.HTTPError as e:
        sys.exit(f"Erro na Management API: HTTP {e.code} {e.read().decode()[:200]}")

    hard = [("TABELAS", "tables"), ("COLUNAS", "cols"), ("ENUMS", "types"),
            ("TRIGGERS", "trigs"), ("FUNÇÕES", "fns"), ("ÍNDICES", "idx")]
    falhou = False
    for nome, k in hard:
        missing = sorted(m for m in mig[k] if m not in db[k])
        mark = "OK" if not missing else f"FALTA {len(missing)}"
        print(f"{nome:10s}: {len(mig[k]):3d} nas migrations | {mark}")
        for m in missing:
            print("    - ausente:", m)
        if missing:
            falhou = True

    # policies: name-diff é só INFO (renomeações). FALHA de verdade = tabela com RLS
    # ligado, ZERO policies no banco E policies definidas nas migrations (= ghost, a
    # migration de policy não rodou). RLS-on+0-policies SEM policy nas migrations é
    # lockdown intencional (ex.: tabelas legado seladas) — só INFO.
    pol_diff = sorted(p for p in mig["pols"] if p not in db["pols"])
    print(f"{'POLICIES':10s}: {len(mig['pols']):3d} nas migrations | {len(pol_diff)} com nome diferente (provável renome — INFO)")
    tbls_com_policy_na_mig = {tbl for (_, tbl) in mig["pols"]}
    ghost = [t for t in db["rls_zero"] if t in tbls_com_policy_na_mig]
    locked = [t for t in db["rls_zero"] if t not in tbls_com_policy_na_mig]
    if ghost:
        falhou = True
        print("    !! RLS ligado, ZERO policies MAS migrations definem policy (ghost):")
        for t in ghost:
            print("       -", t)
    if locked:
        print(f"    INFO: {len(locked)} tabela(s) com RLS + 0 policies (lockdown intencional?): {', '.join(locked)}")
    if not ghost:
        print("    cobertura RLS: nenhum ghost de policy ✔")

    print("\n" + ("DRIFT DETECTADO — corrigir antes do deploy." if falhou else "Schema íntegro — sem fantasmas."))
    sys.exit(1 if falhou else 0)


if __name__ == "__main__":
    main()
