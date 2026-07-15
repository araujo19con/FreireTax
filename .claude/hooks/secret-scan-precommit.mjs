#!/usr/bin/env node
/**
 * PreToolUse(Bash) hook — bloqueia `git commit` se o diff staged contiver segredo.
 *
 * Motivação: em 2026-07 houve vazamento de SUPABASE_DB_PASSWORD + JWT numa
 * config. Este guard-rail impede o próximo. Escaneia apenas linhas ADICIONADAS
 * (`git diff --cached`), então não reclama de segredo que já estava versionado.
 *
 * Protocolo: lê o payload do hook em stdin; se for um `git commit` com segredo,
 * sai com código 2 e escreve o motivo em stderr (Claude recebe e aborta a call).
 * Qualquer erro interno → sai 0 (fail-open: nunca trava um commit legítimo por bug).
 */
import { execSync } from 'node:child_process'

const PATTERNS = [
  { re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, nome: 'JWT (token Supabase/JWT)' },
  { re: /SUPABASE[A-Z0-9_]*(KEY|SECRET|PASSWORD)\s*[:=]\s*['"]?[^\s'"]{8,}/i, nome: 'chave/senha Supabase' },
  { re: /SERVICE_ROLE[A-Z0-9_]*\s*[:=]\s*['"]?[^\s'"]{8,}/i, nome: 'service_role key' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, nome: 'chave privada' },
  { re: /(api[_-]?key|secret|passwd|password|token)\s*[:=]\s*['"][^\s'"]{12,}['"]/i, nome: 'credencial genérica' },
]

async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

try {
  const raw = await readStdin()
  let payload = {}
  try { payload = JSON.parse(raw || '{}') } catch { process.exit(0) }

  const cmd = payload?.tool_input?.command || ''
  if (!/\bgit\b[\s\S]*\bcommit\b/.test(cmd)) process.exit(0) // não é commit → ignora

  let diff = ''
  try {
    diff = execSync('git diff --cached --no-color -U0', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch { process.exit(0) } // sem repo/sem staged → deixa passar

  const added = diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))

  const hits = []
  for (const line of added) {
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        const preview = line.trim().slice(0, 60).replace(/[A-Za-z0-9_-]{6}(?=[A-Za-z0-9_-]{4})/g, '******')
        hits.push(`  • ${p.nome}: ${preview}…`)
      }
    }
  }

  if (hits.length) {
    const uniq = [...new Set(hits)].slice(0, 8)
    process.stderr.write(
      'COMMIT BLOQUEADO — possível segredo no diff staged:\n' +
        uniq.join('\n') +
        '\n\nRemova o segredo (use .env, que já está gitignorado), rode `git reset <arquivo>` ' +
        'se necessário, e tente de novo. Se for falso-positivo (ex.: placeholder em .env.example), ' +
        'o usuário pode commitar fora do Claude Code.\n',
    )
    process.exit(2)
  }
  process.exit(0)
} catch {
  process.exit(0) // fail-open
}
