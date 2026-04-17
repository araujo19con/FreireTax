
-- Folders for grouping companies
CREATE TABLE public.pastas_empresas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pastas_empresas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pastas" ON public.pastas_empresas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own pastas" ON public.pastas_empresas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pastas" ON public.pastas_empresas FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own pastas" ON public.pastas_empresas FOR DELETE USING (auth.uid() = user_id);

-- Junction table: empresa <-> pasta
CREATE TABLE public.pasta_empresa_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pasta_id UUID NOT NULL REFERENCES public.pastas_empresas(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(pasta_id, empresa_id)
);

ALTER TABLE public.pasta_empresa_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pasta items" ON public.pasta_empresa_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own pasta items" ON public.pasta_empresa_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own pasta items" ON public.pasta_empresa_items FOR DELETE USING (auth.uid() = user_id);
