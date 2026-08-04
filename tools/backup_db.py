# -*- coding: utf-8 -*-
"""Backup LÓGICO independente (off-site) do schema public — dados da aplicação.

Por quê: os snapshots do Supabase são a 1ª linha, mas ficam no MESMO fornecedor/
região. Este é a cópia INDEPENDENTE do modelo 3-2-1: exporta os dados via REST
(service role) para um .json.gz versionado, que você guarda numa pasta sincronizada
off-site (OneDrive/Google Drive) + local. O SCHEMA já está versionado no GitHub
(supabase/migrations) — juntos, dados + schema = restauração completa.

Não precisa de Docker nem pg_dump (que não estão nesta máquina). Cobre o schema
`public` (dados de negócio). auth/storage ficam nos snapshots gerenciados do Supabase.

Uso (carregue as credenciais antes — mesmas do pje-env.local.ps1):
  python tools/backup_db.py                 # gera backup + rotaciona
  python tools/backup_db.py --out D:\bkp     # pasta de destino (default: ./backups)
  python tools/backup_db.py --keep 30        # quantos backups manter (default 14)
  python tools/backup_db.py --verify <arq>   # confere um backup (conta linhas por tabela)
  python tools/backup_db.py --exclude cnpj_cache   # pula tabela regenerável (repetível)
"""
import sys, io, os, json, gzip, glob, argparse, datetime, urllib.request, urllib.error
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
PAGE = 1000
# views (derivadas — recriadas pelas migrations) e rpc não entram no backup de dados.
SKIP_PREFIX = ("v_", "rpc/")


def _get(path, headers=None):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", headers=h)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8")), dict(r.headers)


def list_tables():
    """Descobre as tabelas do schema public pela spec OpenAPI do PostgREST."""
    doc, _ = _get("")
    out = []
    for p in (doc.get("paths") or {}):
        name = p.strip("/")
        if not name or "/" in name or name.startswith(SKIP_PREFIX) or name.startswith("v_"):
            continue
        out.append(name)
    return sorted(set(out))


def fetch_all(table):
    rows, offset = [], 0
    while True:
        got, _ = _get(f"{table}?select=*",
                      {"Range-Unit": "items", "Range": f"{offset}-{offset + PAGE - 1}"})
        rows.extend(got)
        if len(got) < PAGE:
            break
        offset += PAGE
    return rows


def do_backup(args):
    if not (URL and KEY):
        sys.exit("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente.")
    os.makedirs(args.out, exist_ok=True)
    tables = [t for t in list_tables() if t not in set(args.exclude or [])]
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    manifest, data = {}, {}
    for t in tables:
        rows = fetch_all(t)
        data[t] = rows
        manifest[t] = len(rows)
        print(f"  {t:34s} {len(rows):>7d} linhas", flush=True)
    payload = {
        "_meta": {
            "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "project": URL, "schema": "public", "tables": len(tables),
            "total_rows": sum(manifest.values()), "counts": manifest,
            "note": "Schema em supabase/migrations (GitHub). Restaurar: migrations -> carregar estes dados.",
        },
        "data": data,
    }
    fn = os.path.join(args.out, f"freiretax_public_{stamp}.json.gz")
    with gzip.open(fn, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, default=str)
    mb = os.path.getsize(fn) / 1e6
    print(f"\nOK — {payload['_meta']['total_rows']} linhas em {len(tables)} tabelas "
          f"-> {fn} ({mb:.1f} MB)")
    # rotação: mantém os N mais recentes
    todos = sorted(glob.glob(os.path.join(args.out, "freiretax_public_*.json.gz")))
    for velho in todos[:-args.keep]:
        os.remove(velho)
        print(f"  rotacionado (removido): {os.path.basename(velho)}")
    return fn


def do_verify(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        payload = json.load(f)
    m = payload.get("_meta", {})
    print(f"Backup: {path}")
    print(f"  gerado em: {m.get('generated_at')} | tabelas: {m.get('tables')} | "
          f"linhas: {m.get('total_rows')}")
    # re-conta a partir dos dados reais (não confia só no manifest)
    real = {t: len(rows) for t, rows in payload.get("data", {}).items()}
    divg = [t for t, n in (m.get("counts") or {}).items() if real.get(t) != n]
    print(f"  integridade: {'OK (manifest == dados)' if not divg else 'DIVERGE: ' + str(divg)}")
    for t in sorted(real):
        print(f"    {t:34s} {real[t]:>7d}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "backups"))
    ap.add_argument("--keep", type=int, default=14)
    ap.add_argument("--exclude", nargs="*", default=[])
    ap.add_argument("--verify")
    a = ap.parse_args()
    if a.verify:
        do_verify(a.verify)
    else:
        do_backup(a)


if __name__ == "__main__":
    main()
