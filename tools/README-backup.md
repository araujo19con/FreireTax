# Modelo de backup e recuperação — Tax Trakker

Objetivo: **não perder dados** e conseguir **restaurar** em qualquer cenário. Segue a
regra **3-2-1** (3 cópias, 2 mídias, 1 off-site) com camadas independentes.

## Camadas (o que protege cada uma)

| Camada                                 | Cobre                                       | Onde                               | Frequência / retenção                                    |
| -------------------------------------- | ------------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| **1. Snapshots gerenciados Supabase**  | Banco INTEIRO (public + auth + storage)     | Supabase (us-east-2)               | Diário automático (Pro, WAL-G ligado). Retenção ~7 dias. |
| **1b. PITR** (recomendado, ver abaixo) | Banco inteiro, a QUALQUER segundo           | Supabase                           | Restaura a um ponto exato dentro da retenção             |
| **2. Schema**                          | Estrutura (tabelas, funções, RLS, triggers) | **GitHub** (`supabase/migrations`) | A cada commit — já é off-site                            |
| **3. Export lógico de dados**          | Dados do schema `public` (negócio)          | `tools/backup_db.py` → `.json.gz`  | Diário (Agendador) + pasta sincronizada off-site         |

- **Camada 1** é a recuperação principal (rápida, completa). **Camada 3** é o seguro
  INDEPENDENTE do fornecedor: se a conta Supabase for comprometida/apagada, ou o
  faturamento cair, os dados de negócio continuam numa cópia sua.
- Tamanho atual: banco ~80 MB; export gzip ~7 MB (sem `cnpj_cache`, que é regenerável).

## Matriz de recuperação (o que fazer em cada incidente)

| Incidente                                   | Como recuperar                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apaguei linhas/uma tabela sem querer        | **PITR** (se ligado) → restaura pro instante anterior. Sem PITR: restaurar o snapshot diário, OU recuperar seletivamente do último `.json.gz` (a tabela afetada). |
| Corrupção / migration ruim                  | Restaurar snapshot diário (dashboard → Database → Backups) ou PITR.                                                                                               |
| Perda do projeto/conta Supabase (pior caso) | Criar projeto novo → `supabase db push` (recria TODO o schema das migrations) → carregar os dados do último `.json.gz`. auth (logins) recriados/reconvidados.     |
| Preciso auditar um estado passado           | Abrir o `.json.gz` do dia (é JSON legível).                                                                                                                       |

## Rodar o backup manualmente

```powershell
cd C:\Users\Gabriel\Desktop\FREIRETAX\tax-trakker
. tools\pje-env.local.ps1            # carrega SUPABASE_URL + SERVICE_ROLE_KEY
python tools\backup_db.py            # gera ./backups/freiretax_public_<data>.json.gz
python tools\backup_db.py --verify tools\..\backups\freiretax_public_XXXX.json.gz  # confere integridade
```

## Agendar (diário, automático)

1. Defina a pasta OFF-SITE (uma pasta que o OneDrive/Google Drive sincroniza):
   ```powershell
   setx FREIRETAX_BACKUP_DEST "C:\Users\Gabriel\OneDrive\FreireTax-Backups"
   ```
2. Registre a tarefa diária (2h da manhã):
   ```powershell
   schtasks /Create /TN "FreireTax Backup DB" /SC DAILY /ST 02:00 /RL LIMITED ^
     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Gabriel\Desktop\FREIRETAX\tax-trakker\tools\backup_db_run.ps1"
   ```
   O wrapper `backup_db_run.ps1` carrega as credenciais, grava em `FREIRETAX_BACKUP_DEST`
   (ou `./backups`), mantém os **30 mais recentes** e exclui `cnpj_cache`.
3. Teste a tarefa: `schtasks /Run /TN "FreireTax Backup DB"`.

> A pasta sincronizada (OneDrive/Drive) já dá a cópia OFF-SITE. Para uma 2ª mídia
> independente, copie periodicamente um `.json.gz` para um HD externo/Backblaze.

## Restaurar os dados de um `.json.gz` (rebuild)

1. Projeto novo (ou local) com o schema aplicado: `supabase db push`.
2. Carregar os dados (na ORDEM de dependência — pais antes de filhos; ou desabilitar
   triggers durante a carga). O `.json.gz` tem `{"data": {tabela: [linhas...]}}` — um
   script de carga faz `upsert` tabela a tabela. (Para DR completo rápido, prefira o
   snapshot gerenciado; o export é o seguro independente / recuperação seletiva.)

## Recomendações de segurança (da auditoria 04/08)

- **Ligar PITR** (Supabase → Database → Backups → Point in Time Recovery). É addon pago
  no Pro (~US$/mês), mas fecha a janela de perda de até 24h dos snapshots diários. Vale
  para um CRM jurídico (LGPD).
- **Rotacionar segredos** já expostos: a senha do banco em `supabase/.temp/db-pw.txt`
  e o Personal Access Token (ambos apareceram em texto). Supabase → Account → Access
  Tokens / Database → Reset password.
- **RLS**: corrigido em `20260804000000_seguranca_rls_search_path.sql` (tabelas
  `contatos`/`socios_processos`/`empresas_skip_log` estavam abertas ao anon).
- **Testar o restore 1x/mês**: `--verify` + carregar um `.json.gz` num projeto de teste.
  Backup que não se restaura não é backup.
