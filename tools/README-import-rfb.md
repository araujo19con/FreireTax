# Importação RFB Slim — Setup

Este script popula a tabela `rfb_estabelecimentos_busca` no Supabase com um slim
da Receita Federal pra permitir **buscar CNPJ pela razão social** (empresas sem
CNPJ cadastrado).

## Quando rodar

- **Primeira vez** após aplicar a migration `20260514000000_rfb_busca_por_nome.sql`.
- **Mensalmente**, depois que a RFB publica o novo dump (~dia 15 do mês).

## Limitação de espaço (Supabase Free tier — 500 MB DB)

A base completa da RFB tem ~50 GB descomprimidos / ~55M de CNPJs. Não cabe no
Free tier. Por isso o script importa **slim**:

- Só estabelecimentos **ATIVOS** (situacao_cadastral = '02')
- Só **UFs configuradas** (default: RN, PB)
- Só **5 colunas** (cnpj, razao_social, nome_fantasia, uf, municipio)

Espaço esperado:

- RN+PB: ~350k registros, ~30 MB + índices trigram ≈ **80 MB total**
- Cabe folgado em 500 MB.

Se quiser adicionar mais UFs: `--ufs RN,PB,PE,CE`. Cuidado com o limite.

## Passo a passo

### 1. Baixar os ZIPs da RFB

Acesse https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/ e baixe o **mês
mais recente** (ex: `2026-04/`).

Você precisa de:

- `Empresas0.zip` ... `Empresas9.zip` — razões sociais
- `Estabelecimentos0.zip` ... `Estabelecimentos9.zip` — endereços e CNPJ completo
- `Municipios.zip` — códigos de município

Os outros arquivos (Socios, Cnaes, etc.) **não são necessários**.

Tamanho total: ~5 GB compactados.

Dica de download (PowerShell paralelo):

```powershell
$base = "https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/2026-04/"
0..9 | ForEach-Object -Parallel {
  Invoke-WebRequest "$using:base/Empresas$_.zip" -OutFile "Empresas$_.zip"
  Invoke-WebRequest "$using:base/Estabelecimentos$_.zip" -OutFile "Estabelecimentos$_.zip"
} -ThrottleLimit 4
Invoke-WebRequest "$base/Municipios.zip" -OutFile "Municipios.zip"
```

### 2. Descompactar

Extraia **tudo** numa pasta única (ex: `D:\rfb-dump\`). Você verá arquivos com
extensão `.EMPRECSV`, `.ESTABELE` e `.MUNICCSV`.

```powershell
Get-ChildItem *.zip | ForEach-Object { Expand-Archive $_.FullName -DestinationPath "D:\rfb-dump\" -Force }
```

### 3. Configurar variáveis de ambiente

Pegue a **service_role key** no painel Supabase (Settings → API → service_role).

⚠️ **NUNCA comite essa key**. Use só localmente.

```powershell
$env:SUPABASE_URL = "https://<seu-projeto>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service_role_key>"
```

### 4. Aplicar a migration (se ainda não foi)

```bash
# Via Supabase CLI
supabase db push

# OU manualmente no SQL Editor do dashboard:
# copie/cole supabase/migrations/20260514000000_rfb_busca_por_nome.sql
```

### 5. Rodar o script

```powershell
cd c:\Users\Gabriel\Desktop\FREIRETAX\tax-trakker
node tools/import-rfb-slim.mjs --from-dir "D:\rfb-dump" --ufs RN,PB --truncate
```

Flags:

- `--from-dir <path>` — pasta com os CSVs descompactados (**obrigatório**)
- `--ufs RN,PB` — UFs (default: RN,PB)
- `--truncate` — apaga a tabela antes (use em refresh mensal)
- `--dry-run` — só conta linhas, não grava (pra testar)
- `--batch 1000` — tamanho do batch de upsert

Tempo esperado:

- Leitura local: ~5-10 min
- Upsert no Supabase Free: ~3-5 min
- **Total: ~10-15 min**

### 6. Verificar

Consulta SQL no dashboard:

```sql
SELECT * FROM v_rfb_busca_status;
-- uf  | total   | atualizado_em
-- RN  | 152340  | 2026-05-14 ...
-- PB  | 198721  | 2026-05-14 ...

SELECT * FROM buscar_rfb_por_nome('tech solutions', 'RN', 10);
```

## Refresh mensal

A RFB publica dump novo todo dia 15. Pra refresh:

1. Baixa os zips novos
2. Roda `node tools/import-rfb-slim.mjs --from-dir ... --truncate`

O `--truncate` garante que CNPJs que foram baixados/inaptos saiam da base.

## Troubleshooting

- **"env vars missing"** → defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
- **"arquivos faltando"** → conferir extensões `.EMPRECSV`, `.ESTABELE`, `.MUNICCSV`.
- **Rate limit no upsert** → reduz `--batch` para 500 ou 250.
- **Tabela > 400 MB** → diminuir UFs ou apagar `nome_fantasia` (alterar script).
