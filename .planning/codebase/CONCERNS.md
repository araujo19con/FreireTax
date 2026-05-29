# Concerns & Technical Debt

**Analysis Date:** 2026-05-29

> Note: Issues listed in `CLAUDE.md` under "Pontos de atenção (bugs já corrigidos)" are NOT reported here — they are already fixed and documented to avoid re-introduction.

---

## Critical Issues

**`Acoes.tsx` uses raw state mutation, not React Query — stale data on concurrent edits:**

- `src/pages/Acoes.tsx` manages all its data (acoes, empresas, elegibilidades, pastas, processos, prospeccoes) via `useState` + a single `fetchAll()` async function called at lines 258–284. Every CRUD mutation calls `fetchAll()` manually (~14 call sites). If a concurrent user edits data, the page does not auto-refresh. `src/pages/Dashboard.tsx` (lines 112–138) and `src/pages/Prospeccao.tsx` share this same raw-fetch pattern. Only hooks in `src/hooks/` use React Query properly.
- Impact: Concurrent edits silently overwrite each other; stale data shown without warning.
- Fix: Migrate these pages to React Query with appropriate `queryKey` + `invalidateQueries` — the pattern already exists in `src/hooks/useEmpresas.ts`.

**Dead functions with `_` prefix never called in `Acoes.tsx`:**

- `_handleDeleteProcesso` (line 841), `_handleDeleteProsp` (line 936), `_getEmpresaNome` (line 439), `_getProcessoForEleg` (line 441), `_getProspeccaoForEleg` (line 443), `_getProspStatusColor` (line 957) are defined but never called in the JSX. They contain database mutations and status-switch logic that could be accidentally re-introduced.
- Files: `src/pages/Acoes.tsx`
- Fix: Remove dead code.

**`Importacao.tsx` retains a migration-version fallback that should be removed:**

- Lines 856–869 of `src/pages/Importacao.tsx`: when the initial `insert` with all columns fails, it falls back to a retry without `quantidade_funcionarios`, `faturamento_anual`, etc. and shows a `toast.warning` referencing migration `20260424`. That migration was applied months ago. The fallback now masks real insert errors.
- Files: `src/pages/Importacao.tsx` (lines 847–870)

---

## Performance Concerns

**Map view fetches all 27 Brazilian state GeoJSONs in parallel on every open — no caching:**

- `src/lib/ibgeGeo.ts` `fetchBrazilStatesGeoJSON()` (line 78) fires 27 concurrent `fetch()` calls to the IBGE API. The municipio drill-down fallback path (lines 204–225) batches up to N×municipalities individual requests in groups of 25. No React Query or `useMemo` keyed by UF — each map open re-fetches everything.
- Files: `src/lib/ibgeGeo.ts`, `src/pages/empresas/EmpresasMapView.tsx`
- Impact: High latency on first render; IBGE API rate limits could cause partial map renders.
- Fix: Wrap in React Query with `queryKey: ["geo", uf]` and `staleTime: 3600_000`.

**`xlsx` library imported at module level in 10 files — always bundled into every lazy chunk:**

- `import * as XLSX from "xlsx"` appears in: `src/pages/Dashboard.tsx`, `src/pages/Acoes.tsx`, `src/pages/AnaliseRFB.tsx`, `src/pages/Importacao.tsx`, `src/pages/Financeiro.tsx`, `src/pages/Relatorios.tsx`, `src/pages/Empresas.tsx`, `src/pages/acoes/ImportacaoProspeccaoDialog.tsx`, `src/pages/empresas/ImportarParaPastaDialog.tsx`, `src/lib/exportEmpresasAcao.ts`.
- `xlsx` (~900 KB uncompressed) loads on page entry rather than only when the user triggers an export/import action.
- Fix: Use dynamic `import("xlsx")` inside the export/import handler functions.

**`Acoes.tsx` `fetchAll()` reloads all 7 tables after every single mutation:**

- `fetchAll()` (lines 258–284) runs 7 parallel `fetchAllRows` calls across all tables. This fires after every edit — process update, prospection create, elegibilidade add, etc. (~14 call sites throughout the file).
- Impact: As data grows (1k+ companies × N actions), mutations incur 5–15 seconds of background re-fetch.

**`CriteriosAdmin.tsx` copies criteria sequentially with 1 DB round-trip per criterion:**

- `src/pages/elegibilidade/CriteriosAdmin.tsx` lines 348–362 iterates with a `for...of` loop calling `createC.mutateAsync` one at a time. For actions with 20+ criteria, this serializes 20+ sequential DB round-trips.
- Fix: Batch insert via a single Supabase `insert([...])` call.

---

## Security Concerns

**Route `/admin` has no route-level guard — only sidebar visibility is restricted:**

- `src/App.tsx` line 126: the `/admin` route renders `<Admin />` for any authenticated user. Only `/usuarios` is wrapped in `<RequireAdmin>`. A non-admin can navigate directly to `/admin` via URL. RLS prevents actual data mutation, but admin UI panels (user management, config) are visible.
- Files: `src/App.tsx` (line 126), `src/pages/Admin.tsx`
- Fix: Wrap `/admin` route in `<RequireAdmin>` or a `<RequireRole role="gestor">` guard.

**`ALLOWED_ORIGINS` env var undocumented as unset in production — silently breaks enrichment:**

- Both `supabase/functions/enriquecer-cnpj/index.ts` (line 19) and `supabase/functions/criar-usuario/index.ts` (line 14) `console.warn` at cold start if `ALLOWED_ORIGINS` is empty and will reject all cross-domain CORS requests. If this variable is unset in the Supabase production environment, all enrichment and user-creation calls from the Vercel frontend silently fail with a CORS block (no user-facing error, no server log surfaced in UI).
- Fix: Confirm `ALLOWED_ORIGINS=https://freire-tax.vercel.app` is set in Supabase Dashboard → Edge Functions → Secrets.

**CNPJ validation in edge function uses digit-count only, not mod-11:**

- `supabase/functions/enriquecer-cnpj/index.ts` line 43: `validCNPJ` only checks `normalizeCNPJ(s).length === 14`. The frontend uses the real mod-11 algorithm from `src/lib/cnpj.ts`. Any 14-digit string is accepted by the edge function, wasting enrichment quota on structurally invalid CNPJs.
- Files: `supabase/functions/enriquecer-cnpj/index.ts` (line 43)

---

## Technical Debt

**~60 `supabase.from(...) as any` casts suppress the generated type system across the codebase:**

- Concentrated in: `src/pages/Acoes.tsx` (lines 617, 667, 899, 915, 937), `src/pages/Importacao.tsx` (lines 849, 881, 945, 953, 1019, 1105, 1152, 1167), `src/hooks/useEmpresas.ts` (lines 652, 691), `src/hooks/useQualificacao.ts` (lines 34, 212, 219, 276), `src/hooks/useCriterios.ts` (line 35), `src/hooks/usePropostas.ts` (lines 9, 11), and many more.
- Root cause: `src/integrations/supabase/types.ts` is documented as auto-generated but its currency relative to the current schema (39 migrations applied since initial creation) is unknown. Tables added in recent migrations (`honorarios_lancamentos`, `prazos_processuais`, `rfb_estabelecimentos_busca`) may not appear in the types file.
- Fix: Run `supabase gen types typescript --local > src/integrations/supabase/types.ts` after each migration deployment. Then eliminate `as any` casts one file at a time.

**Duplicate `formatCurrency` defined locally in pages that already import from `src/lib/format.ts`:**

- `src/pages/Acoes.tsx` (line 178) and `src/pages/Dashboard.tsx` (line 93) each define their own local `formatCurrency` function with identical `Intl.NumberFormat` implementation.
- Files: `src/pages/Acoes.tsx` (line 178), `src/pages/Dashboard.tsx` (line 93), `src/lib/format.ts`
- Fix: Remove local definitions; import `formatCurrency` from `@/lib/format`.

**Duplicate local `Empresa` interface in `Acoes.tsx` and `Dashboard.tsx` instead of the exported type from `useEmpresas.ts`:**

- `src/pages/Acoes.tsx` (lines 83–100) and `src/pages/Dashboard.tsx` (lines 50–80) each declare their own partial `Empresa` interface. The canonical `Empresa` export lives in `src/hooks/useEmpresas.ts` and is used correctly elsewhere. Local copies can silently drift from the real schema.

**`Acoes.tsx` is an 1800-line god component managing ~40 `useState` dialog-form variables:**

- Lines 183–255 declare ~40 `useState` calls for process, prospection, and eligibility dialog fields. Each dialog could be extracted into a dedicated component or hook, matching the pattern used by `PropostaDialog`, `TarefaDialog`, `ReuniaoDialog`.
- Files: `src/pages/Acoes.tsx` (entire file, 1805 lines as of 2026-05-29)
- Impact: Any new feature requires navigating 1800+ lines; high merge-conflict surface area.

**Two separate DOMPurify sanitizers for proposal HTML with slightly different configs:**

- `src/components/PropostaDialog.tsx` (line 39) defines `sanitizeProposalHTML` locally with an explicit `ALLOWED_TAGS`/`ALLOWED_ATTR` list. `src/lib/proposta.ts` (line 112) exports `sanitizeProposalHtml` using `USE_PROFILES: { html: true }` (a broader permissive preset). These can silently diverge.
- Fix: Consolidate into one exported sanitizer in `src/lib/proposta.ts` and import it in `PropostaDialog`.

**5 `eslint-disable-next-line react-hooks/exhaustive-deps` suppressions hide potential stale-closure bugs:**

- Files: `src/pages/MeuEspaco.tsx` (line 35), `src/components/RichTextEditor.tsx` (line 56), `src/components/ReuniaoDialog.tsx` (line 155), `src/components/PropostaDialog.tsx` (line 122), `src/components/MunicipioMultiSelect.tsx` (line 50).
- Each suppression should be reviewed and commented with rationale, or fixed.

---

## Scalability Limits

**`fetchAllRows` SAFETY_CAP of 200,000 rows could exhaust browser memory at scale:**

- `src/lib/supabaseFetchAll.ts` (line 52) defaults to `safetyCap = 200_000`. `Acoes.tsx` `fetchAll()` loads empresas + elegibilidades + processos + prospeccoes simultaneously (lines 260–273). At 5k companies × 10 actions = 50k eligibility rows, all 7 tables are loaded into JavaScript arrays in parallel.
- Fix: Add server-side filtering before `fetchAllRows` for panel/map views; avoid loading unbounded result sets into state.

**`rfb_estabelecimentos_busca` table covers only RN+PB by default:**

- CLAUDE.md documents that the RFB slim table is populated only for configured UFs (default: RN+PB via `tools/import-rfb-slim.mjs`). `BuscarCNPJDialog` and `buscar-cnpj-por-nome` edge function return empty results for any company outside those states. As the firm's geographic scope grows, this table must be manually expanded.
- Files: `tools/import-rfb-slim.mjs`, `supabase/migrations/20260514000000_rfb_busca_por_nome.sql`

---

## Known Workarounds

**`topojson-client` used in `ibgeGeo.ts` but not declared as an explicit dependency:**

- `src/lib/ibgeGeo.ts` line 3: `import { feature } from "topojson-client"`. This package does not appear in `package.json` dependencies or devDependencies. It likely resolves as a transitive dependency of `react-simple-maps`. If `react-simple-maps` is updated or replaced, this import will break at build time.
- Files: `src/lib/ibgeGeo.ts` (line 3), `package.json`
- Fix: Add `topojson-client` and `@types/topojson-client` as explicit dependencies.

**Bulk enrichment (`useBulkEnrich.ts`) has no retry on 429 from edge function — just marks failed:**

- `src/hooks/useBulkEnrich.ts` invokes `enriquecer-cnpj` per company without backoff. The edge function returns 429 when BrasilAPI rate-limits. The bulk hook catches the error and marks the company as failed with no retry. CLAUDE.md documents the 350ms+retry pattern for BrasilAPI backfill but it lives only in `tools/`, not in the frontend bulk hook.
- Files: `src/hooks/useBulkEnrich.ts`

**`Financeiro.tsx` derives `atrasado` status in the browser at render time — DB is never updated:**

- `src/pages/Financeiro.tsx` (line 80) `autoStatus()` function re-derives `atrasado` status from `data_vencimento` in JavaScript on every render. The actual `status` column in `honorarios_lancamentos` remains `pendente` forever. Any future DB-side reporting, alerts, or the `verificar-prazos` edge function querying this column directly will see incorrect data.
- Files: `src/pages/Financeiro.tsx` (line 80), `supabase/migrations/20260528000002_honorarios_lancamentos.sql`
- Fix: Add a Postgres trigger or cron-based call to `supabase/functions/verificar-prazos/` to mark overdue lancamentos as `atrasado` in the DB.

---

## Missing Features

**No automated `atrasado` status updates for honorarios — as noted above under Known Workarounds.**

**No error monitoring / alerting service integrated:**

- `src/components/ErrorBoundary.tsx` (line 21) uses `console.error` as the only structured error capture. No Sentry, Datadog, or equivalent. Production errors are invisible unless the developer has the browser console open.

**No tests for React components, hooks, or any page-level logic:**

- Only `src/lib/cnpj.test.ts`, `src/lib/criterios.test.ts`, `src/lib/proposta.test.ts`, and `src/lib/supabaseFetchAll.test.ts` exist — covering pure utility functions only. Zero tests for components, hooks (`useEmpresas`, `useQualificacao`, `useBulkEnrich`), or page flows (importacao, qualification wizard, enrichment).
- Files: `vitest.config.ts`, `src/test/`
- Risk: Refactoring any hook or page has no safety net.

---

## Dependency Risks

**`xlsx` version `^0.18.5` is the last AGPLv3-licensed SheetJS CE release (2022):**

- SheetJS changed from MIT to AGPL after `0.18.5`. This version is 2+ years old with no security patches and no support for modern Excel formats (XLSX 2019+, dynamic arrays). Using AGPL software in a commercial SPA may require a commercial license.
- Files: `package.json` (line 74: `"xlsx": "^0.18.5"`)
- Migration path: Evaluate `exceljs` (MIT) or purchase SheetJS Pro.

**`react-simple-maps ^3.0.0` is unmaintained (last commit 2022):**

- Used in `src/pages/empresas/EmpresasMapView.tsx`. No releases since 2022; open issues about D3 v7 compatibility and React 18 concurrent mode. React 19 upgrade could break the map view.
- Files: `package.json`, `src/pages/empresas/EmpresasMapView.tsx`

**`expr-eval ^2.0.2` evaluates formula strings from the database with no server-side validation on save:**

- `src/hooks/useQualificacao.ts` (line 8) uses `expr-eval` `Parser` to evaluate `formula_valor` strings stored in `criterios_elegibilidade`. Expressions are admin-entered. A malformed formula (e.g., circular reference, missing operand) causes a runtime exception during qualification of any company under that action.
- Files: `src/hooks/useQualificacao.ts` (line 161), `src/lib/criterios.ts`
- Fix: Validate/sandbox formula strings at save time in `CriteriosAdmin.tsx`.

**`@hello-pangea/dnd ^18.0.1` (react-beautiful-dnd community fork) has no React 19 support roadmap:**

- Used for kanban drag-and-drop in `src/pages/Prospeccao.tsx`. Community fork with limited maintenance activity.
- Files: `package.json`, `src/pages/Prospeccao.tsx`

---

_Concerns audit: 2026-05-29_
