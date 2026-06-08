#!/usr/bin/env node
/**
 * tools/backfill-contatos-rfb.mjs
 *
 * Backfill ÚNICO: deriva contatos (sócios do QSA + telefone/email RFB) das
 * empresas JÁ enriquecidas, para empresa_contatos. Mesma lógica do trigger
 * derive_contatos_from_rfb, mas inserindo direto em lotes (sem transação
 * gigante — não estoura timeout do SQL Editor).
 *
 * Daqui pra frente o TRIGGER cuida das novas; isto é só pra base existente.
 * Idempotente (dedup_key) — pode re-rodar.
 *
 *   export SUPABASE_URL="https://<ref>.supabase.co"        # ou VITE_SUPABASE_URL
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role>"
 *   node tools/backfill-contatos-rfb.mjs [--dry-run] [--batch 500]
 */

import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const flag = (n) => {
  const i = argv.indexOf(n);
  return i < 0 ? null : argv[i + 1];
};
const DRY_RUN = has("--dry-run");
const BATCH = Number(flag("--batch") || 500);

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

// Normalização idêntica à função SQL normaliza_nome_contato / importador DRIVA.
const normNome = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
const onlyDigits = (s) => String(s ?? "").replace(/\D/g, "");
const trimOrNull = (s) => {
  const v = String(s ?? "").trim();
  return v === "" ? null : v;
};

function withDefaults(c) {
  return {
    nome: null, cargo: null, email: null, telefone: null, linkedin: null,
    cpf_mascarado: null, faixa_etaria: null, observacoes: null,
    papel: "outro", origem: "manual",
    tipo_telefone: "desconhecido", whatsapp: false, is_contador: false,
    principal: false,
    ...c,
  };
}

async function main() {
  // 1) Lê todas as empresas enriquecidas (com qsa OU telefone OU email).
  console.log("> Lendo empresas enriquecidas...");
  const empresas = [];
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, qsa, telefone_receita, email_receita")
        .or("qsa.not.is.null,telefone_receita.not.is.null,email_receita.not.is.null")
        .range(from, from + PAGE - 1);
      if (error) throw new Error("Falha ao ler empresas: " + error.message);
      empresas.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`> ${empresas.length} empresas enriquecidas.`);

  // 2) Constrói contatos candidatos por empresa.
  const porEmpresa = new Map(); // empresa_id -> [contatos]
  for (const e of empresas) {
    const lista = [];
    const qsa = Array.isArray(e.qsa) ? e.qsa : [];
    for (const s of qsa) {
      const nome = trimOrNull(s?.nome);
      if (!nome) continue;
      lista.push({
        nome,
        cargo: trimOrNull(s?.qualificacao),
        papel: "socio",
        cpf_mascarado: trimOrNull(s?.documento),
        origem: "rfb",
        dedup_key: "socio:" + normNome(nome),
      });
    }
    const telD = onlyDigits(e.telefone_receita);
    if (telD.length >= 8) {
      lista.push({
        telefone: e.telefone_receita,
        papel: "geral",
        origem: "rfb",
        dedup_key: "tel:" + telD,
      });
    }
    const email = trimOrNull(e.email_receita)?.toLowerCase();
    if (email) {
      lista.push({ email, papel: "geral", origem: "rfb", dedup_key: "email:" + email });
    }
    if (lista.length) porEmpresa.set(e.id, lista);
  }

  // 3) dedup_keys e empresas que já têm contato (não sobrescrever principal).
  // Pagina TODOS os contatos (tabela pequena) — evita URL gigante com .in().
  const existentes = new Set(); // `${empresa_id}|${dedup_key}`
  const comContato = new Set();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("empresa_contatos")
        .select("empresa_id, dedup_key")
        .range(from, from + PAGE - 1);
      if (error) throw new Error("Falha ao ler contatos existentes: " + error.message);
      for (const c of data ?? []) {
        comContato.add(c.empresa_id);
        if (c.dedup_key) existentes.add(`${c.empresa_id}|${c.dedup_key}`);
      }
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }

  // 4) Monta as linhas novas + define principal onde a empresa não tem nenhum.
  const linhas = [];
  for (const [empresaId, lista] of porEmpresa) {
    const vistos = new Set();
    const novos = [];
    for (const c of lista) {
      const k = `${empresaId}|${c.dedup_key}`;
      if (existentes.has(k) || vistos.has(k)) continue;
      vistos.add(k);
      novos.push({ empresa_id: empresaId, ...c });
    }
    if (!novos.length) continue;
    if (!comContato.has(empresaId)) {
      const principal =
        novos.find((c) => /administrador/i.test(c.cargo ?? "")) ||
        novos.find((c) => c.papel === "socio") ||
        novos.find((c) => c.nome) ||
        novos[0];
      if (principal) principal.principal = true;
    }
    linhas.push(...novos);
  }

  console.log(`> Contatos novos a inserir: ${linhas.length} (de ${porEmpresa.size} empresas).`);

  if (DRY_RUN) {
    console.table(
      linhas.slice(0, 8).map((l) => ({
        emp: l.empresa_id.slice(0, 8),
        nome: l.nome ?? "(canal)",
        papel: l.papel,
        cargo: l.cargo ?? "",
        principal: !!l.principal,
      })),
    );
    console.log("> [dry-run] nada gravado.");
    return;
  }

  let n = 0;
  for (let i = 0; i < linhas.length; i += BATCH) {
    const chunk = linhas.slice(i, i + BATCH).map(withDefaults);
    const { error } = await supabase.from("empresa_contatos").insert(chunk);
    if (error) throw new Error("Falha ao inserir: " + error.message);
    n += chunk.length;
    process.stdout.write(`\r> Inseridos ${n}/${linhas.length}...`);
  }
  process.stdout.write("\n");
  console.log(`> Pronto. ${n} contatos derivados do RFB.`);
}

main().catch((e) => {
  console.error("\nFALHA:", e.message);
  process.exit(1);
});
