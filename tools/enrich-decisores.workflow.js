export const meta = {
  name: 'enrich-decisores',
  description: 'Pesquisa web de decisor tributário + telefone/email por empresa. Fan-out com cap automático de concorrência — substitui as ondas manuais de agentes.',
  phases: [
    { title: 'Pesquisa', detail: 'um agente prospeccao-enricher por empresa; o harness limita a concorrência automaticamente' },
  ],
}

// ============================================================================
// COMO USAR (o Workflow não lê arquivos — a worklist entra via `args`):
//
//   1) Gerar a worklist priorizada (fora do workflow):
//        set -a && . ./tools/.env.local && set +a
//        node tools/diag_system.mjs --status prospect --top 300
//      → escreve tools/worklist_system.json
//
//   2) O orquestrador (loop principal) lê o JSON e chama:
//        Workflow({ scriptPath: 'tools/enrich-decisores.workflow.js',
//                   args: { empresas: <conteúdo de worklist_system.json> } })
//
//   3) O workflow devolve o array consolidado [{id, nome, contatos:[...]}].
//      O orquestrador grava em tools/found_sys_all.json e roda:
//        node tools/insert_decisor_by_id.mjs --file tools/found_sys_all.json --dry-run
//        node tools/insert_decisor_by_id.mjs --file tools/found_sys_all.json
//
// POR QUE ISTO SUBSTITUI AS ONDAS MANUAIS:
//   • Concurrency cap = min(16, cores-2) → nunca estoura o limite da conta.
//   • Cada empresa é um item isolado → sem race de índice de lote, sem batch pulado.
//   • schema força o formato de saída (retry automático se o agente errar).
//   • Empresas sem retorno viram {contatos:[]} e aparecem no resumo (reconciliação).
// ============================================================================

const CONTATO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'id exato da empresa recebida' },
    nome: { type: 'string' },
    contatos: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nome: { type: 'string', description: 'decisor; vazio se contato institucional' },
          cargo: { type: 'string' },
          confianca: { type: 'string', enum: ['alta', 'média', 'baixa'] },
          fonte: { type: 'string' },
          linkedin: { type: 'string' },
          telefone: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['confianca'],
      },
    },
  },
  required: ['id', 'contatos'],
}

const empresas = (args && (args.empresas || (Array.isArray(args) ? args : null))) || []

if (!empresas.length) {
  log('Nenhuma empresa em args.empresas. Rode `node tools/diag_system.mjs` e passe a worklist via args.')
  return []
}

log(`Enriquecendo ${empresas.length} empresas (decisor tributário + telefone/email). Concorrência limitada pelo harness.`)

function promptFor(e) {
  return [
    'Pesquise o decisor tributário/fiscal e o máximo de telefone/email da empresa abaixo.',
    'Siga suas instruções de agente (alvo por prioridade, LinkedIn só via snippet, confiança honesta).',
    '',
    'DADOS DA EMPRESA:',
    JSON.stringify(
      {
        id: e.id,
        nome: e.nome,
        razao_social: e.razao_social,
        cnpj: e.cnpj,
        uf: e.uf,
        municipio: e.municipio,
        porte: e.porte,
        capital_social: e.capital_social,
        qsa: e.qsa,
        telefone_receita: e.telefone_receita,
        email_receita: e.email_receita,
      },
      null,
      1,
    ),
    '',
    `Devolva o objeto no schema, com id = "${e.id}" (copiado exatamente).`,
  ].join('\n')
}

const results = await parallel(
  empresas.map((e) => () =>
    agent(promptFor(e), {
      label: `decisor:${String(e.nome || e.id).slice(0, 24)}`,
      phase: 'Pesquisa',
      schema: CONTATO_SCHEMA,
      agentType: 'prospeccao-enricher',
    })
      .then((r) => (r && r.id ? r : { id: e.id, nome: e.nome, contatos: [], _miss: true }))
      .catch(() => ({ id: e.id, nome: e.nome, contatos: [], _miss: true })),
  ),
)

const found = results.filter(Boolean)
const temContato = (r) => Array.isArray(r.contatos) && r.contatos.length > 0
const comDecisor = found.filter((r) => temContato(r) && r.contatos.some((c) => (c.nome || '').trim())).length
const comTel = found.filter((r) => temContato(r) && r.contatos.some((c) => c.telefone)).length
const comEmail = found.filter((r) => temContato(r) && r.contatos.some((c) => c.email)).length
const miss = found.filter((r) => r._miss).length

log(`Concluído: ${comDecisor}/${found.length} c/ decisor nomeado · ${comTel} c/ telefone · ${comEmail} c/ email · ${miss} sem retorno`)

// Remove o marcador interno antes de devolver (formato = contrato do insert_decisor_by_id.mjs)
return found.map(({ _miss, ...r }) => r)
