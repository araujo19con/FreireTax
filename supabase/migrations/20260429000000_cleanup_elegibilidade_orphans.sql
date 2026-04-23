-- Limpeza defensiva: remove elegibilidades órfãs (acao_id aponta pra
-- ação que não existe mais) caso o CASCADE tenha falhado em algum ponto
-- histórico. Idempotente — executa 0 deletes se não houver órfãos.

delete from public.elegibilidade e
where not exists (
  select 1 from public.acoes_tributarias a where a.id = e.acao_id
);

-- Garante que a FK está com ON DELETE CASCADE (pode ter sido alterada
-- em algum momento). Idempotente: se já existe, recria idêntica.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'elegibilidade_acao_id_fkey'
      and conrelid = 'public.elegibilidade'::regclass
  ) then
    alter table public.elegibilidade drop constraint elegibilidade_acao_id_fkey;
  end if;

  alter table public.elegibilidade
    add constraint elegibilidade_acao_id_fkey
    foreign key (acao_id) references public.acoes_tributarias(id) on delete cascade;
end $$;
