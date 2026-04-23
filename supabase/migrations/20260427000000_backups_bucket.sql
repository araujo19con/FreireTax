-- =============================================================================
-- Backup completo do sistema — bucket privado para snapshots JSON
-- =============================================================================
-- Bucket "backups" guarda snapshots gerados pela edge function "backup-completo".
-- Acesso restrito a admin (lê/escreve/deleta). Usuário comum nem vê o bucket.
--
-- Convenção de path: backups/<YYYY-MM-DD>/<HHMMSS>-<motivo>.json
--   Ex: backups/2026-04-22/143022-manual.json
--       backups/2026-04-22/030000-cron.json
--
-- Tamanho típico: 1-10 MB (depende do volume; bucket cabe milhares).
-- Retenção: a edge function se encarrega de deletar snapshots > 90 dias.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Policies: só admin manipula. Idempotentes.
DROP POLICY IF EXISTS "Admin read backups" ON storage.objects;
DROP POLICY IF EXISTS "Admin upload backups" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete backups" ON storage.objects;

CREATE POLICY "Admin read backups"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'backups' AND public.is_admin(auth.uid()));

CREATE POLICY "Admin upload backups"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'backups' AND public.is_admin(auth.uid()));

CREATE POLICY "Admin delete backups"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'backups' AND public.is_admin(auth.uid()));
