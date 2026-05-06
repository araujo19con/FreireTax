-- Remove o status "Não iniciado" do sistema.
-- Empresas elegíveis sem prospecção agora aparecem como "Aguardando" no painel.
-- Prospecções existentes com status "Não iniciado" são deletadas (a empresa volta
-- a aparecer como "Aguardando" no painel da ação).
DELETE FROM public.prospeccoes
WHERE status_prospeccao = 'Não iniciado';
