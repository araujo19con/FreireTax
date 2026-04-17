// Supabase Edge Function: criar-usuario
// Cria um novo usuário via Admin API (sem trocar a sessão do chamador).
// Apenas usuários com role 'admin' podem invocar.
//
// Body: { email, password, nome, role, telefone?, cargo? }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

type AppRole = "admin" | "advogado" | "comercial" | "gestor";
const VALID_ROLES: AppRole[] = ["admin", "advogado", "comercial", "gestor"];

interface Payload {
  email: string;
  password: string;
  nome: string;
  role: AppRole;
  telefone?: string;
  cargo?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Política de senha mínima:
 * - 8+ caracteres
 * - ao menos 1 letra e 1 dígito
 * Mantida simples para alinhar com a UX do CRM; pode ser endurecida depois.
 */
function validatePassword(pw: string): string | null {
  if (typeof pw !== "string") return "senha inválida";
  if (pw.length < 8) return "senha precisa de ao menos 8 caracteres";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "senha precisa conter letras e números";
  return null;
}

serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing auth" }, 401, cors);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: errUser } = await asUser.auth.getUser();
    if (errUser || !caller) return json({ error: "invalid token" }, 401, cors);

    const { data: isAdmin } = await asUser.rpc("is_admin", { _user_id: caller.id });
    if (!isAdmin) return json({ error: "apenas admin pode criar usuários" }, 403, cors);

    const raw = (await req.json().catch(() => null)) as Partial<Payload> | null;
    if (!raw) return json({ error: "payload inválido" }, 400, cors);

    const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
    const nome = typeof raw.nome === "string" ? raw.nome.trim() : "";
    const password = typeof raw.password === "string" ? raw.password : "";
    const role = raw.role as AppRole;
    const telefone = typeof raw.telefone === "string" ? raw.telefone.trim() : undefined;
    const cargo = typeof raw.cargo === "string" ? raw.cargo.trim() : undefined;

    if (!EMAIL_RE.test(email)) return json({ error: "email inválido" }, 400, cors);
    if (nome.length < 2) return json({ error: "nome obrigatório" }, 400, cors);
    const pwErr = validatePassword(password);
    if (pwErr) return json({ error: pwErr }, 400, cors);
    if (!VALID_ROLES.includes(role)) return json({ error: "role inválido" }, 400, cors);

    // cliente service role (admin API)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: created, error: errCreate } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome },
    });

    if (errCreate || !created.user) {
      return json({ error: "erro ao criar usuário", detail: errCreate?.message }, 400, cors);
    }

    const newUserId = created.user.id;

    // O trigger handle_new_user já cria profile + role comercial.
    // Atualizamos dados extras e, se precisar, trocamos a role.
    if (telefone !== undefined || cargo !== undefined) {
      const { error: errProf } = await admin
        .from("profiles")
        .update({ telefone: telefone || null, cargo: cargo || null })
        .eq("id", newUserId);
      if (errProf) {
        // Dados opcionais falharam — log, mas não reverter o usuário.
        console.error("falha ao atualizar profile:", errProf.message);
      }
    }

    if (role !== "comercial") {
      // Remove default 'comercial' (se o trigger já inseriu) e insere a role solicitada.
      // Em caso de erro, tenta reverter — pelo menos deixa o user com 'comercial'.
      const { error: errIns } = await admin
        .from("user_roles")
        .insert({ user_id: newUserId, role });
      if (errIns) {
        console.error("falha ao inserir role:", errIns.message);
        return json(
          {
            ok: false,
            warning: "usuário criado com role 'comercial' padrão; atribua o papel manualmente",
            user_id: newUserId,
            email,
            detail: errIns.message,
          },
          207, // Multi-Status
          cors
        );
      }

      // só remove 'comercial' DEPOIS de garantir que a nova role foi gravada
      const { error: errDel } = await admin
        .from("user_roles")
        .delete()
        .eq("user_id", newUserId)
        .eq("role", "comercial");
      if (errDel) {
        console.error("falha ao remover role default:", errDel.message);
        // não é fatal — o usuário fica com duas roles
      }
    }

    return json({ ok: true, user_id: newUserId, email, role }, 200, cors);
  } catch (e) {
    return json({ error: (e as Error).message }, 500, cors);
  }
});
