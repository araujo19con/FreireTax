-- Adiciona coluna pra persistir dispensa do banner/tutorial cross-device.
-- NULL = usuário ainda não dispensou. Timestamp = quando dispensou.
alter table public.profiles
  add column if not exists tutorial_seen_at timestamptz;

comment on column public.profiles.tutorial_seen_at is
  'Quando o usuário dispensou o banner de boas-vindas do tutorial. NULL = nunca dispensou.';
