-- Log de empresas tentadas mas não encontradas (evita retrabalho)
create table if not exists public.empresas_skip_log (
  id uuid primary key default gen_random_uuid(),
  empresa_nome text not null,
  uf text not null,
  motivo text, -- "sem_match", "nome_variado", "fora_uf", etc.
  tentativas int default 1,
  primeira_tentativa timestamp default now(),
  ultima_tentativa timestamp default now(),
  created_at timestamp default now()
);

create index idx_skip_log_uf_empresa on public.empresas_skip_log(uf, empresa_nome);
