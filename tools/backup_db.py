# -*- coding: utf-8 -*-
"""Backup LÓGICO independente (off-site) do schema public — dados da aplicação.

Por quê: os snapshots do Supabase são a 1ª linha, mas ficam no MESMO fornecedor/
região. Este é a cópia INDEPENDENTE do modelo 3-2-1: exporta os dados via REST
(service role) para um .json.gz versionado, guardado numa pasta sincronizada
off-site (Google Drive). O SCHEMA já está versionado no GitHub (supabase/migrations).

CUSTO ZERO: usa só o service role + REST (egress trivial ~5 MB/dia) e o seu Drive.
Sem Docker, sem pg_dump, sem addon pago.

Robustez (para não falhar em silêncio):
- Paginação por Content-Range/count=exact (completa mesmo se o max-rows do PostgREST
  for < página); confere len == total por tabela.
- Retry com backoff em erro de rede/HTTP.
- Escrita ATÔMICA (arquivo .part -> rename): nunca deixa .gz corrompido.
- Se alguma tabela falhar mesmo após retries: salva o que deu como *.INCOMPLETE,
  NÃO rotaciona (preserva os bons) e sai com código != 0 (a tarefa acusa falha).
- Auto-verificação: relê o arquivo gerado e confere as contagens.

Uso (carregue as credenciais antes — mesmas do pje-env.local.ps1):
  python tools/backup_db.py                 # gera backup + rotaciona
  python tools/backup_db.py --out D:\bkp     # pasta de destino (default: ./backups)
  python tools/backup_db.py --keep 30        # quantos backups manter (default 14)
  python tools/backup_db.py --verify <arq>   # confere um backup (conta linhas por tabela)
  python tools/backup_db.py --exclude cnpj_cache   # pula tabela regenerável (repetível)
"""
import sys, io, os, json, gzip, glob, time, argparse, datetime, urllib.request, urllib.error
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

URL = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
PAGE = 1000
TRIES = 4
# views (derivadas — recriadas pelas migrations) e rpc não entram no backup de dados.
SKIP_PREFIX = ("v_",)


def _req(path, headers=None):
    """GET com retry/backoff. Retorna (json, headers). Levanta na última tentativa."""
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    if headers:
        h.update(headers)
    last = None
    for i in range(TRIES):
        try:
            req = urllib.request.Request(f"{URL}/rest/v1/{path}", headers=h)
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read().decode("utf-8")
                return (json.loads(body) if body else []), dict(r.headers)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            if i < TRIES - 1:
                time.sleep(1.5 * (i + 1))  # 1.5s, 3s, 4.5s
    raise last


def list_tables():
    """Descobre as tabelas do schema public pela spec OpenAPI do PostgREST."""
    doc, _ = _req("")
    out = []
    for p in (doc.get("paths") or {}):
        name = p.strip("/")
        if not name or "/" in name or name.startswith(SKIP_PREFIX):
            continue
        out.append(name)
    return sorted(set(out))


def fetch_all(table):
    """Todas as linhas da tabela. Usa Content-Range (count=exact) para saber o TOTAL
    e paginar até completar — não confia em 'página cheia'. Confere len == total."""
    rows, offset, total = [], 0, None
    while True:
        got, hdr = _req(f"{table}?select=*", {
            "Range-Unit": "items", "Range": f"{offset}-{offset + PAGE - 1}",
            "Prefer": "count=exact"})
        rows.extend(got)
        cr = hdr.get("Content-Range", "")           # ex.: "0-999/2500" ou "*/0"
        if "/" in cr and cr.split("/")[-1].isdigit():
            total = int(cr.split("/")[-1])
        if not got:
            break
        offset += len(got)                          # avança pelo REAL recebido
        if total is not None and offset >= total:
            break
        if total is None and len(got) < PAGE:       # fallback sem Content-Range
            break
    if total is not None and len(rows) != total:
        raise RuntimeError(f"paginação incompleta em {table}: {len(rows)}/{total}")
    return rows


def _write_atomic(path, payload):
    tmp = path + ".part"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, default=str)
    os.replace(tmp, path)                           # rename atômico


def do_backup(args):
    if not (URL and KEY):
        sys.exit("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente.")
    os.makedirs(args.out, exist_ok=True)
    tables = [t for t in list_tables() if t not in set(args.exclude or [])]
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    manifest, data, failed = {}, {}, []
    for t in tables:
        try:
            rows = fetch_all(t)
            data[t] = rows
            manifest[t] = len(rows)
            print(f"  {t:34s} {len(rows):>7d} linhas", flush=True)
        except Exception as e:
            failed.append(t)
            print(f"  {t:34s}  FALHOU: {str(e)[:70]}", flush=True)
    incompleto = bool(failed)
    payload = {
        "_meta": {
            "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "project": URL, "schema": "public", "tables": len(data),
            "total_rows": sum(manifest.values()), "counts": manifest,
            "incomplete": incompleto, "failed_tables": failed,
            "note": "Schema em supabase/migrations (GitHub). Restaurar: migrations -> carregar estes dados.",
        },
        "data": data,
    }
    suffix = ".INCOMPLETE.json.gz" if incompleto else ".json.gz"
    fn = os.path.join(args.out, f"freiretax_public_{stamp}{suffix}")
    _write_atomic(fn, payload)
    mb = os.path.getsize(fn) / 1e6

    # auto-verificação: relê e confere contagens
    ok = verify_file(fn, quiet=True)
    print(f"\n{'[INCOMPLETO] ' if incompleto else ''}{payload['_meta']['total_rows']} linhas em "
          f"{len(data)} tabelas -> {fn} ({mb:.1f} MB) | verificação: {'OK' if ok else 'FALHOU'}")

    if incompleto or not ok:
        print(f"ATENÇÃO: backup {'incompleto ('+', '.join(failed)+')' if failed else 'não verificou'}. "
              f"Backups anteriores PRESERVADOS (sem rotação).")
        sys.exit(1)

    # rotação só quando o backup está COMPLETO e verificado
    keep = max(1, args.keep)
    todos = sorted(glob.glob(os.path.join(args.out, "freiretax_public_*.json.gz")))
    completos = [f for f in todos if not f.endswith(".INCOMPLETE.json.gz")]
    for velho in completos[:-keep]:
        os.remove(velho)
        print(f"  rotacionado (removido): {os.path.basename(velho)}")
    return fn


def verify_file(path, quiet=False):
    """Relê o .gz, confere manifest == dados reais. Retorna True/False."""
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        if not quiet:
            print(f"ERRO ao abrir {path}: {e}")
        return False
    m = payload.get("_meta", {})
    real = {t: len(rows) for t, rows in payload.get("data", {}).items()}
    divg = [t for t, n in (m.get("counts") or {}).items() if real.get(t) != n]
    if not quiet:
        print(f"Backup: {path}")
        print(f"  gerado em: {m.get('generated_at')} | tabelas: {m.get('tables')} | "
              f"linhas: {m.get('total_rows')} | incompleto: {m.get('incomplete')}")
        print(f"  integridade: {'OK (manifest == dados)' if not divg else 'DIVERGE: ' + str(divg)}")
        for t in sorted(real):
            print(f"    {t:34s} {real[t]:>7d}")
    return not divg and not m.get("incomplete")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "backups"))
    ap.add_argument("--keep", type=int, default=14)
    ap.add_argument("--exclude", nargs="*", default=[])
    ap.add_argument("--verify")
    a = ap.parse_args()
    if a.verify:
        ok = verify_file(a.verify)
        sys.exit(0 if ok else 1)
    do_backup(a)


if __name__ == "__main__":
    main()
