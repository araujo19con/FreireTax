#!/usr/bin/env node
/**
 * tools/infer_validate_emails.mjs — 100% offline/deterministico (zero tokens).
 *
 * Sobre um arquivo no formato do found_sys_all.json:
 *   1. VALIDA emails existentes via DNS MX lookup (email com dominio sem MX = morto).
 *   2. NORMALIZA telefones para E.164 BR (+55...), preservando 0800.
 *   3. INFERE email de decisor nomeado sem email: extrai o dominio corporativo dos
 *      emails institucionais da MESMA empresa (ignora provedores genericos), gera
 *      candidatos nos padroes BR comuns e valida o dominio via MX.
 *      Candidato inferido NAO vira `email` automaticamente — vai para
 *      `email_candidatos` (revisao humana / checagem SMTP futura), a menos que
 *      rode com --apply (ai o 1o candidato MX-valido vira `email` e a fonte é anotada).
 *
 * Uso:
 *   node tools/infer_validate_emails.mjs --file tools/found_sys_all.json           # relatorio
 *   node tools/infer_validate_emails.mjs --file tools/found_sys_all.json --apply   # grava <file>.enriched.json
 */
import fs from "node:fs";
import dns from "node:dns/promises";

const argv = process.argv.slice(2);
const FILE = argv[argv.indexOf("--file") + 1];
const APPLY = argv.includes("--apply");
if (!FILE || !fs.existsSync(FILE)) { console.error("Uso: --file <found_*.json> [--apply]"); process.exit(1); }

// provedores genericos: dominio nao identifica a empresa
const GENERICOS = new Set(["gmail.com","hotmail.com","outlook.com","yahoo.com","yahoo.com.br","bol.com.br","uol.com.br","terra.com.br","icloud.com","live.com","globo.com","ig.com.br"]);
// preposicoes que nao entram no padrao de email
const PREPS = new Set(["de","da","do","dos","das","e","em","junior","filho","neto"]);

const mxCache = new Map();
async function hasMX(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  let ok = false;
  try { ok = (await dns.resolveMx(domain)).length > 0; } catch { ok = false; }
  mxCache.set(domain, ok);
  return ok;
}

function normPhone(raw) {
  if (!raw) return raw;
  const d = String(raw).replace(/\D/g, "");
  if (/^0800/.test(d)) return d;                       // 0800 fica como esta
  if (d.length === 10 || d.length === 11) return "+55" + d;
  if (d.length === 12 || d.length === 13) return d.startsWith("55") ? "+" + d : raw;
  return raw;                                          // fora do padrao: nao mexe
}

function nameTokens(nome) {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/\s+/).map((t) => t.replace(/[^a-z]/g, ""))   // remove ( ) . - etc.
    .filter((t) => t.length > 1 && !PREPS.has(t));
}

function candidates(nome, domain) {
  const t = nameTokens(nome);
  if (!t.length) return [];
  const first = t[0], last = t[t.length - 1];
  const set = new Set([
    `${first}.${last}@${domain}`,
    `${first}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first}${last}@${domain}`,
    `${last}.${first}@${domain}`,
  ]);
  return [...set];
}

const registros = JSON.parse(fs.readFileSync(FILE, "utf-8"));
let emailsOk = 0, emailsMortos = 0, telsNorm = 0, inferidos = 0, semDominio = 0;

for (const reg of registros) {
  const contatos = reg.contatos || [];
  // dominio corporativo: 1o dominio nao-generico visto nos emails da empresa
  const dominio = contatos.map((c) => (c.email || "").split("@")[1]).find((d) => d && !GENERICOS.has(d.toLowerCase()));

  for (const c of contatos) {
    if (c.telefone) { const p = normPhone(c.telefone); if (p !== c.telefone) { c.telefone = p; telsNorm++; } }
    if (c.email) {
      const dom = c.email.split("@")[1]?.toLowerCase();
      const ok = dom ? await hasMX(dom) : false;
      if (ok) emailsOk++; else { emailsMortos++; c.email_mx_invalido = true; console.log(`[MX-MORTO] ${reg.nome}: ${c.email}`); }
    } else if ((c.nome || "").trim() && dominio) {
      if (await hasMX(dominio)) {
        const cands = candidates(c.nome, dominio);
        c.email_candidatos = cands;
        inferidos++;
        if (APPLY && cands.length) {
          c.email = cands[0];
          c.fonte = `${c.fonte || ""} | email inferido por padrao de dominio (${dominio}, MX valido) — NAO confirmado`.trim();
          if (c.confianca === "alta") c.confianca = "média"; // inferencia rebaixa
        }
        console.log(`[INFER] ${reg.nome}: ${c.nome} -> ${cands.join(", ")}`);
      }
    } else if ((c.nome || "").trim() && !c.email) {
      semDominio++;
    }
  }
}

console.log(`\n=== Resumo: ${emailsOk} emails MX-ok, ${emailsMortos} MX-morto, ${telsNorm} telefones normalizados, ${inferidos} decisores com candidatos inferidos, ${semDominio} sem dominio conhecido ===`);

if (APPLY) {
  const out = FILE.replace(/\.json$/, ".enriched.json");
  fs.writeFileSync(out, JSON.stringify(registros, null, 1));
  console.log(`Gravado: ${out}`);
}
