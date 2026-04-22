-- Caminho/URL do template .docx oficial usado pra gerar Word com timbrado idêntico.
-- Pode ser:
--   - URL absoluta (ex: arquivo padrão em /public/template-proposta-padrao.docx)
--   - storage path no bucket "proposta-templates" (futuro: upload customizado)

ALTER TABLE propostas_templates
  ADD COLUMN IF NOT EXISTS docx_template_path text DEFAULT '/template-proposta-padrao.docx';

COMMENT ON COLUMN propostas_templates.docx_template_path IS
  'Caminho do .docx oficial. Default: /template-proposta-padrao.docx (em /public). Suporta override por template.';

-- Backfill: garante que templates existentes tenham o default
UPDATE propostas_templates
SET docx_template_path = '/template-proposta-padrao.docx'
WHERE docx_template_path IS NULL;
