
-- Tabela de empresas
CREATE TABLE public.empresas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nome TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prospect',
  obs TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de ações tributárias
CREATE TABLE public.acoes_tributarias (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'INICIAL',
  status TEXT NOT NULL DEFAULT 'Ativa',
  vinculo TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de elegibilidade (relação empresa x ação)
CREATE TABLE public.elegibilidade (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE NOT NULL,
  acao_id UUID REFERENCES public.acoes_tributarias(id) ON DELETE CASCADE NOT NULL,
  elegivel BOOLEAN NOT NULL DEFAULT false,
  justificativa TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, acao_id)
);

-- Enable RLS
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acoes_tributarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elegibilidade ENABLE ROW LEVEL SECURITY;

-- RLS policies for empresas
CREATE POLICY "Users can view own empresas" ON public.empresas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own empresas" ON public.empresas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own empresas" ON public.empresas FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own empresas" ON public.empresas FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for acoes_tributarias
CREATE POLICY "Users can view own acoes" ON public.acoes_tributarias FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own acoes" ON public.acoes_tributarias FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own acoes" ON public.acoes_tributarias FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own acoes" ON public.acoes_tributarias FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for elegibilidade
CREATE POLICY "Users can view own elegibilidade" ON public.elegibilidade FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own elegibilidade" ON public.elegibilidade FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own elegibilidade" ON public.elegibilidade FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own elegibilidade" ON public.elegibilidade FOR DELETE USING (auth.uid() = user_id);
