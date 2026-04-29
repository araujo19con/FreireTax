-- Flags que protegem email/telefone de serem sobrescritos pela enrichment RFB
-- quando o valor foi setado manualmente (dialog) ou via importação de planilha.
--
-- Quando true, a edge function `enriquecer-cnpj` pula o campo correspondente
-- ao atualizar a empresa, mesmo que a BrasilAPI retorne um valor.
--
-- Quando o usuário limpa o campo no dialog (valor vazio), a flag é resetada
-- pra false, permitindo que a próxima sincronização RFB preencha de novo.

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS email_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telefone_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN empresas.email_manual IS
  'true quando email_receita foi setado manualmente. RFB enrichment pula este campo se true.';

COMMENT ON COLUMN empresas.telefone_manual IS
  'true quando telefone_receita foi setado manualmente. RFB enrichment pula este campo se true.';
