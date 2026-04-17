-- =========================================================================
-- Sistema de usuários, papéis, tarefas (com subtarefas/comentários/anexos)
-- e reuniões comerciais com convite ICS por email.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. ENUMS
-- -------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'advogado', 'comercial', 'gestor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tarefa_prioridade AS ENUM ('baixa', 'media', 'alta', 'urgente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tarefa_status AS ENUM ('pendente', 'em_andamento', 'concluida', 'cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reuniao_status AS ENUM ('agendada', 'realizada', 'cancelada', 'no_show', 'reagendada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- 2. PROFILES
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL DEFAULT '',
  email text NOT NULL,
  telefone text,
  cargo text,
  avatar_url text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_ativo ON public.profiles(ativo);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- 3. USER_ROLES (separada de profiles para segurança)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Função security definer: evita recursão de RLS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin');
$$;

-- -------------------------------------------------------------------------
-- 4. TRIGGER: auto-criar profile quando usuário se registra em auth.users
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nome)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  -- papel default: comercial (admin deve promover depois)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'comercial')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed: criar profiles para usuários já existentes
INSERT INTO public.profiles (id, email, nome)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'nome', split_part(u.email, '@', 1))
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- Seed: papel comercial para usuários que ainda não têm nenhum
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'comercial'::public.app_role
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id);

-- -------------------------------------------------------------------------
-- 5. FUNÇÃO updated_at genérica
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------
-- 6. TAREFAS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  acao_id uuid REFERENCES public.acoes_tributarias(id) ON DELETE SET NULL,
  prospeccao_id uuid REFERENCES public.prospeccoes(id) ON DELETE SET NULL,
  prazo timestamptz,
  prioridade public.tarefa_prioridade NOT NULL DEFAULT 'media',
  status public.tarefa_status NOT NULL DEFAULT 'pendente',
  concluida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tarefas_assigned_to ON public.tarefas(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tarefas_status ON public.tarefas(status);
CREATE INDEX IF NOT EXISTS idx_tarefas_prazo ON public.tarefas(prazo);
CREATE INDEX IF NOT EXISTS idx_tarefas_empresa_id ON public.tarefas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_prospeccao_id ON public.tarefas(prospeccao_id);

ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS tarefas_set_updated_at ON public.tarefas;
CREATE TRIGGER tarefas_set_updated_at
  BEFORE UPDATE ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------
-- 7. SUBTAREFAS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subtarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  concluida boolean NOT NULL DEFAULT false,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subtarefas_tarefa_id ON public.subtarefas(tarefa_id);
ALTER TABLE public.subtarefas ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- 8. COMENTÁRIOS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tarefa_comentarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  texto text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tarefa_comentarios_tarefa_id ON public.tarefa_comentarios(tarefa_id);
ALTER TABLE public.tarefa_comentarios ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- 9. ANEXOS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tarefa_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  nome text NOT NULL,
  storage_path text NOT NULL,
  tamanho_bytes bigint,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tarefa_anexos_tarefa_id ON public.tarefa_anexos(tarefa_id);
ALTER TABLE public.tarefa_anexos ENABLE ROW LEVEL SECURITY;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('tarefa-anexos', 'tarefa-anexos', false)
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------------------
-- 10. REUNIÕES
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reunioes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  advogado_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  prospeccao_id uuid REFERENCES public.prospeccoes(id) ON DELETE SET NULL,
  lead_nome text NOT NULL,
  lead_email text NOT NULL,
  data_inicio timestamptz NOT NULL,
  data_fim timestamptz NOT NULL,
  local text,
  link_reuniao text,
  status public.reuniao_status NOT NULL DEFAULT 'agendada',
  notas text,
  ics_uid text UNIQUE DEFAULT gen_random_uuid()::text,
  ics_enviado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reunioes_advogado_id ON public.reunioes(advogado_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_data_inicio ON public.reunioes(data_inicio);
CREATE INDEX IF NOT EXISTS idx_reunioes_prospeccao_id ON public.reunioes(prospeccao_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_status ON public.reunioes(status);

ALTER TABLE public.reunioes ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS reunioes_set_updated_at ON public.reunioes;
CREATE TRIGGER reunioes_set_updated_at
  BEFORE UPDATE ON public.reunioes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------
-- 11. Campo "responsavel_id" nas entidades de negócio
-- -------------------------------------------------------------------------
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS responsavel_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.acoes_tributarias
  ADD COLUMN IF NOT EXISTS responsavel_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.prospeccoes
  ADD COLUMN IF NOT EXISTS responsavel_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_empresas_responsavel ON public.empresas(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_acoes_responsavel ON public.acoes_tributarias(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_prospeccoes_responsavel ON public.prospeccoes(responsavel_id);

-- -------------------------------------------------------------------------
-- 12. RLS POLICIES
-- -------------------------------------------------------------------------

-- PROFILES: todos autenticados veem, cada um edita o seu; admin edita todos
DROP POLICY IF EXISTS "Authenticated can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin can insert profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin can delete profile" ON public.profiles;

CREATE POLICY "Authenticated can view profiles"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Admin can update any profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admin can insert profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admin can delete profile"
  ON public.profiles FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- USER_ROLES: todos veem, só admin escreve
DROP POLICY IF EXISTS "Authenticated can view roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admin can manage roles" ON public.user_roles;

CREATE POLICY "Authenticated can view roles"
  ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin can manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- TAREFAS: todos autenticados veem (para coordenação); criador/responsável/admin editam
DROP POLICY IF EXISTS "Authenticated can view tarefas" ON public.tarefas;
DROP POLICY IF EXISTS "Authenticated can insert tarefas" ON public.tarefas;
DROP POLICY IF EXISTS "Owner or admin can update tarefas" ON public.tarefas;
DROP POLICY IF EXISTS "Owner or admin can delete tarefas" ON public.tarefas;

CREATE POLICY "Authenticated can view tarefas"
  ON public.tarefas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert tarefas"
  ON public.tarefas FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Owner or admin can update tarefas"
  ON public.tarefas FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  )
  WITH CHECK (true);

CREATE POLICY "Owner or admin can delete tarefas"
  ON public.tarefas FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

-- SUBTAREFAS: segue a tarefa-mãe
DROP POLICY IF EXISTS "Authenticated can view subtarefas" ON public.subtarefas;
DROP POLICY IF EXISTS "Authenticated can manage subtarefas" ON public.subtarefas;

CREATE POLICY "Authenticated can view subtarefas"
  ON public.subtarefas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can manage subtarefas"
  ON public.subtarefas FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tarefas t
      WHERE t.id = tarefa_id
        AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()
             OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tarefas t
      WHERE t.id = tarefa_id
        AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()
             OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'))
    )
  );

-- COMENTÁRIOS: todos veem, cada um só edita/apaga os seus
DROP POLICY IF EXISTS "Authenticated can view comentarios" ON public.tarefa_comentarios;
DROP POLICY IF EXISTS "Authenticated can insert comentarios" ON public.tarefa_comentarios;
DROP POLICY IF EXISTS "Author can update comentarios" ON public.tarefa_comentarios;
DROP POLICY IF EXISTS "Author or admin can delete comentarios" ON public.tarefa_comentarios;

CREATE POLICY "Authenticated can view comentarios"
  ON public.tarefa_comentarios FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert comentarios"
  ON public.tarefa_comentarios FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Author can update comentarios"
  ON public.tarefa_comentarios FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Author or admin can delete comentarios"
  ON public.tarefa_comentarios FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- ANEXOS
DROP POLICY IF EXISTS "Authenticated can view anexos" ON public.tarefa_anexos;
DROP POLICY IF EXISTS "Authenticated can insert anexos" ON public.tarefa_anexos;
DROP POLICY IF EXISTS "Author or admin can delete anexos" ON public.tarefa_anexos;

CREATE POLICY "Authenticated can view anexos"
  ON public.tarefa_anexos FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert anexos"
  ON public.tarefa_anexos FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Author or admin can delete anexos"
  ON public.tarefa_anexos FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- REUNIÕES: todos veem, advogado/criador/admin/gestor editam
DROP POLICY IF EXISTS "Authenticated can view reunioes" ON public.reunioes;
DROP POLICY IF EXISTS "Authenticated can insert reunioes" ON public.reunioes;
DROP POLICY IF EXISTS "Owner or admin can update reunioes" ON public.reunioes;
DROP POLICY IF EXISTS "Owner or admin can delete reunioes" ON public.reunioes;

CREATE POLICY "Authenticated can view reunioes"
  ON public.reunioes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert reunioes"
  ON public.reunioes FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Owner or admin can update reunioes"
  ON public.reunioes FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR advogado_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  )
  WITH CHECK (true);

CREATE POLICY "Owner or admin can delete reunioes"
  ON public.reunioes FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR advogado_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

-- -------------------------------------------------------------------------
-- 13. STORAGE policies (bucket tarefa-anexos)
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated read tarefa-anexos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload tarefa-anexos" ON storage.objects;
DROP POLICY IF EXISTS "Author delete tarefa-anexos" ON storage.objects;

CREATE POLICY "Authenticated read tarefa-anexos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tarefa-anexos');

CREATE POLICY "Authenticated upload tarefa-anexos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tarefa-anexos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Author delete tarefa-anexos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'tarefa-anexos'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin(auth.uid()))
  );
