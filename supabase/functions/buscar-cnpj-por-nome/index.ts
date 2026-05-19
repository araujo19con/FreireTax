// Supabase Edge Function: buscar-cnpj-por-nome
//
// Busca candidatos de CNPJ pela razão social usando a tabela slim
// rfb_estabelecimentos_busca (populada pelo ETL tools/import-rfb-slim.mjs).
//
// Body: { termo: string, uf?: string, limite?: number }
//   - termo: razão social ou nome fantasia (mínimo 3 chars)
//   - uf: opcional, filtra por UF (RN, PB, ...)
//   - limite: top N resultados (default 20, max 100)
//
// Return: { ok: true, candidatos: Array<{ cnpj, razao_social, nome_fantasia, uf, municipio, score }> }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  console.warn(
    "[buscar-cnpj-por-nome] ALLOWED_ORIGINS não configurado — CORS rejeitará todas as origens cross-domain"
  );
}

function corsFor(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowAll = ALLOWED_ORIGINS.includes("*");
  const allowed = allowAll || ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (allowAll ? "*" : origin) : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface Candidato {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  uf: string;
  municipio: string | null;
  score: number;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

  let step = "init";
  try {
    step = "read-env";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY =
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    if (!SUPABASE_URL || !ANON_KEY) {
      return json({ error: "env vars missing", step }, 500, cors);
    }

    step = "auth";
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader) return json({ error: "missing auth", step }, 401, cors);

    // Usa cliente AS-USER pra respeitar RLS (a tabela rfb_busca tem RLS read pra authenticated)
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: errAuth,
    } = await asUser.auth.getUser();
    if (errAuth || !caller) {
      return json({ error: "invalid token", step, detail: errAuth?.message }, 401, cors);
    }

    step = "parse-body";
    const body = (await req.json().catch(() => null)) as {
      termo?: string;
      uf?: string;
      limite?: number;
    } | null;

    const termo = (body?.termo ?? "").trim();
    if (termo.length < 3) {
      return json({ error: "termo precisa ter pelo menos 3 caracteres", step }, 400, cors);
    }

    const uf = body?.uf ? body.uf.trim().toUpperCase() : null;
    if (uf && !/^[A-Z]{2}$/.test(uf)) {
      return json({ error: "uf inválido (use 2 letras)", step }, 400, cors);
    }

    const limite = Math.min(Math.max(body?.limite ?? 20, 1), 100);

    step = "rpc-busca";
    const { data, error } = await asUser.rpc("buscar_rfb_por_nome", {
      termo,
      uf_filtro: uf,
      limite,
    });
    if (error) {
      return json({ error: "falha na busca", step, detail: error.message }, 500, cors);
    }

    const candidatos = (data ?? []) as Candidato[];
    return json({ ok: true, candidatos, total: candidatos.length }, 200, cors);
  } catch (e) {
    const err = e as Error;
    console.error(`[buscar-cnpj-por-nome] step=${step} error=${err.message}\n${err.stack}`);
    return json({ error: err.message, step }, 500, cors);
  }
});
