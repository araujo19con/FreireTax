# External Integrations

**Analysis Date:** 2026-05-29

## Supabase

- **Purpose:** Core BaaS — Postgres database, authentication, storage, real-time, and edge function hosting
- **How used:**
  - All data reads/writes go through the typed Supabase client
  - Auth: email/password via Supabase Auth; JWT stored in localStorage
  - Row-Level Security enforced at the database layer
  - Edge functions invoked via `supabase.functions.invoke()`
  - Postgres RPCs called via `supabase.rpc()` (e.g., `buscar_rfb_por_nome`)
- **Auth method:** Anon key (`VITE_SUPABASE_PUBLISHABLE_KEY`) for client calls; service role key used inside edge functions for admin operations
- **Key files:**
  - `src/integrations/supabase/client.ts` — singleton client instance
  - `src/integrations/supabase/types.ts` — autogerado DB types (1,624 lines; use Grep, never read whole file)
  - `src/hooks/useAuth.ts` — primary auth hook
  - `supabase/migrations/` — append-only SQL migrations
- **Required env vars:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Project URL:** `https://fxsuwvgcybjbuqqcuskt.supabase.co`

## BrasilAPI

- **Purpose:** Primary source for CNPJ enrichment — company data from Receita Federal (monthly snapshot via Minha Receita)
- **How used:** Called inside `supabase/functions/enriquecer-cnpj/index.ts` as the first attempt in the enrichment cascade. No rate limit in practice. Returns company name, address, CNAE, QSA, Simples/MEI status, etc.
- **Auth method:** None — public API
- **Endpoint:** `https://brasilapi.com.br/api/cnpj/v1/{cnpj}`
- **Rate limits:** Aggressive on some endpoints; CNPJ endpoint has a 429 path handled with backfill delay of 350ms + retry
- **Key files:** `supabase/functions/enriquecer-cnpj/index.ts`
- **CSP:** Allowed in `vercel.json` under `connect-src`

## CNPJa Open

- **Purpose:** First fallback for CNPJ enrichment when BrasilAPI returns 404 (live data, not snapshot)
- **How used:** Called inside `supabase/functions/enriquecer-cnpj/index.ts` when BrasilAPI 404s. Response normalized to the same `BrasilAPICNPJ` shape via `cnpjaToBrasilAPI()`.
- **Auth method:** None — public API (free tier: 5 req/min)
- **Endpoint:** `https://open.cnpja.com/office/{cnpj}`
- **Key files:** `supabase/functions/enriquecer-cnpj/index.ts`
- **CSP:** Allowed in `vercel.json` under `connect-src`

## ReceitaWS

- **Purpose:** Second/last fallback for CNPJ enrichment (live query to Receita Federal)
- **How used:** Called inside `supabase/functions/enriquecer-cnpj/index.ts` when both BrasilAPI and CNPJa fail. Response normalized via `receitaWSToBrasilAPI()`.
- **Auth method:** None — public API (free tier: 3 req/min)
- **Endpoint:** `https://receitaws.com.br/v1/cnpj/{cnpj}`
- **Key files:** `supabase/functions/enriquecer-cnpj/index.ts`
- **CSP:** Allowed in `vercel.json` under `connect-src`

## Gmail SMTP (via denomailer)

- **Purpose:** Sending iCalendar (ICS) meeting invites to lawyers and leads after a meeting is created or updated
- **How used:** Inside `supabase/functions/enviar-convite-reuniao/index.ts` using the `denomailer` Deno library (`https://deno.land/x/denomailer@1.6.0/mod.ts`). Generates a `.ics` attachment and emails it to attendees.
- **Auth method:** Gmail App Password (not regular password; requires 2FA + App Password from Google Account)
- **Required secrets (Supabase Edge Function Secrets):**
  - `GMAIL_USER` — sender address (e.g., `agendamentos@freirepignataro.com.br`)
  - `GMAIL_APP_PASSWORD` — 16-char app password
  - `GMAIL_FROM_NAME` — display name (e.g., "Freire Pignataro Advogados")
- **Key files:** `supabase/functions/enviar-convite-reuniao/index.ts`

## IBGE Servico de Dados

- **Purpose:** Geographic/municipal data (referenced in CSP)
- **How used:** Referenced in `vercel.json` CSP `connect-src` (`https://servicodados.ibge.gov.br`). Likely used in map views or address lookups.
- **Auth method:** None — public API
- **Key files:** `src/pages/empresas/EmpresasMapView.tsx` (likely consumer)

## Receita Federal RFB (local import)

- **Purpose:** Offline/batch CNPJ lookup by company name (razao social) without calling external APIs
- **How used:** The `tools/import-rfb-slim.mjs` script imports a slim subset of the RFB establishment database into the Supabase table `rfb_estabelecimentos_busca` (only ATIVAS, only configured UFs — default RN+PB). The UI then searches this local copy via RPC `buscar_rfb_por_nome(termo, uf, limite)` or the edge function `buscar-cnpj-por-nome`.
- **Auth method:** Not applicable (local data import)
- **Key files:**
  - `tools/import-rfb-slim.mjs` — ETL script
  - `supabase/functions/buscar-cnpj-por-nome/index.ts` — edge function wrapper for the RPC
  - `src/components/BuscarCNPJDialog.tsx` — UI consumer

## Vercel

- **Purpose:** Frontend hosting and deployment
- **How used:** Auto-deploy on push to `main` branch. SPA rewrite configured so all routes serve `index.html`. Security headers applied at CDN level.
- **Auth method:** Git integration (GitHub push triggers deploy)
- **Config:** `vercel.json`
- **URL:** `https://freire-tax.vercel.app`

## Edge Function Secrets (Supabase)

All edge functions require these auto-injected Supabase vars (no manual configuration needed):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (used by `enriquecer-cnpj` and `criar-usuario` for admin operations)

Additional secret required per function:

- `ALLOWED_ORIGINS` — must be set to `https://freire-tax.vercel.app` in production (fail-closed CORS; without it, all cross-domain requests are rejected)
- Gmail secrets — only for `enviar-convite-reuniao` (see Gmail section above)

---

_Integration audit: 2026-05-29_
