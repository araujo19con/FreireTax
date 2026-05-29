# Tech Stack

**Analysis Date:** 2026-05-29

## Runtime & Build

- **Language:** TypeScript 5.8.3
- **Runtime:** Browser (Vite SPA); Edge functions run on Deno (Supabase)
- **Build tool:** Vite 5.4.19 with `@vitejs/plugin-react-swc` (SWC compiler — faster than Babel)
- **Package manager:** Bun (lockfile: `bun.lock`; always use `bun`, not `npm`)
- **Dev server port:** 8080

## Frontend Framework

- **React** 18.3.1 + react-dom 18.3.1
- **Router:** react-router-dom 6.30.1 (lazy routes + Suspense)
- **Entry point:** `index.html` → `src/main.tsx`
- **Path alias:** `@/` → `src/` (configured in `vite.config.ts` and `vitest.config.ts`)

## UI & Styling

- **Component library:** shadcn/ui (style: `default`, base color: `slate`, CSS variables enabled)
  - Config: `components.json`
  - Primitives live in `src/components/ui/` — do not edit unless explicitly requested
- **Radix UI primitives** (all via shadcn): accordion, alert-dialog, avatar, checkbox, dialog, dropdown-menu, label, popover, progress, radio-group, scroll-area, select, separator, slot, switch, tabs, toast, toggle, toggle-group, tooltip
- **Icons:** lucide-react 0.462.0
- **CSS framework:** Tailwind CSS 3.4.17
  - Config: `tailwind.config.ts`
  - Plugins: `tailwindcss-animate`, `@tailwindcss/typography`
  - Dark mode: `class` strategy
- **Design tokens (via CSS variables):**
  - Color scale: primary, secondary, destructive, muted, accent, card, sidebar, success, warning, info
  - Shadow scale: `xs`, `card`, `elevated`, `overlay`
  - Font families: `font-heading` (Playfair Display/Georgia serif), `font-body` (Inter/system-ui)
  - Semantic font sizes: `display`, `h1`, `h2`, `h3`, `micro`
  - Border radius: `--radius` CSS variable
- **Theme switching:** next-themes 0.3.0
- **Utilities:** clsx 2.1.1, tailwind-merge 2.6.0, class-variance-authority 0.7.1

## State & Data Fetching

- **Server state / caching:** @tanstack/react-query 5.83.0
  - Global config: `staleTime: 30s`, `refetchOnWindowFocus: false`
- **Forms:** react-hook-form 7.61.1 + @hookform/resolvers 3.10.0
- **Validation:** zod 3.25.76
- **No global client state manager** — React Query + local useState/useReducer only

## Backend / API

- **BaaS:** Supabase (project ID: `fxsuwvgcybjbuqqcuskt`)
  - Client: `@supabase/supabase-js` 2.98.0
  - Typed client at `src/integrations/supabase/client.ts` — uses autogerado `src/integrations/supabase/types.ts` (1,624 lines — never read whole file, use Grep)
  - Session storage: `localStorage`, `persistSession: true`, `autoRefreshToken: true`
- **Auth:** Supabase Auth (JWT, anon key); primary hook `src/hooks/useAuth.ts`
- **Database:** Supabase Postgres with RLS; migrations in `supabase/migrations/` (append-only, timestamp-ordered SQL files)
- **Edge functions runtime:** Deno (Supabase Edge Runtime) — `supabase/functions/`

## Key Dependencies

| Package                                   | Version  | Purpose                                                        |
| ----------------------------------------- | -------- | -------------------------------------------------------------- |
| `@supabase/supabase-js`                   | ^2.98.0  | Database, auth, edge function calls                            |
| `@tanstack/react-query`                   | ^5.83.0  | Server state, caching, data fetching                           |
| `react-hook-form`                         | ^7.61.1  | Form state management                                          |
| `zod`                                     | ^3.25.76 | Schema validation                                              |
| `react-router-dom`                        | ^6.30.1  | Client-side routing                                            |
| `recharts`                                | ^2.15.4  | Charts/data visualization (Dashboard)                          |
| `@tiptap/react` + `@tiptap/starter-kit`   | ^3.22.4  | Rich text editor (`PropostaDialog`)                            |
| `docxtemplater` + `pizzip` + `file-saver` | varies   | DOCX template generation and download                          |
| `xlsx`                                    | ^0.18.5  | Excel import/export (`src/pages/Importacao.tsx`)               |
| `date-fns`                                | ^3.6.0   | Date formatting; use locale `pt-BR` when displaying            |
| `react-simple-maps`                       | ^3.0.0   | Geographic map view (`src/pages/empresas/EmpresasMapView.tsx`) |
| `@hello-pangea/dnd`                       | ^18.0.1  | Drag-and-drop kanban (Prospeccao)                              |
| `dompurify`                               | ^3.4.1   | HTML sanitization for rich text output                         |
| `expr-eval`                               | ^2.0.2   | Expression evaluation for eligibility rules                    |
| `sonner`                                  | ^1.7.4   | Toast notifications (preferred over Radix toast)               |
| `cmdk`                                    | ^1.1.1   | Command palette                                                |
| `lovable-tagger`                          | ^1.1.13  | Dev-only Lovable component tagger (Vite plugin)                |
| `rollup-plugin-visualizer`                | ^5.14.0  | Bundle analysis (mode `analyze` -> `dist/stats.html`)          |

## Dev Tooling

- **Linter:** ESLint 9.32.0 — config: `eslint.config.js`
  - Tier 1 (all TS/TSX): `@eslint/js` recommended + `typescript-eslint` recommended + `react-hooks` + `react-refresh`
  - Tier 2 (`src/` only): type-aware checks (`no-floating-promises`, `await-thenable` as warn)
  - `no-explicit-any`: warn (gradual migration; ~117 existing hits)
- **Formatter:** Prettier 3.8.3 — config: `.prettierrc.json`
  - `printWidth: 100`, `tabWidth: 2`, `singleQuote: false`, `trailingComma: "es5"`, `endOfLine: "lf"`
  - Plugin: `prettier-plugin-tailwindcss` (auto-sorts Tailwind classes)
- **Type checker:** `tsc --noEmit` via `bun run typecheck`
- **Test runner:** Vitest 3.2.4 — config: `vitest.config.ts`
  - Environment: jsdom; globals: true; setup file: `src/test/setup.ts`
  - Coverage: v8 provider; reporters: text, html, json-summary; output: `./coverage`
  - Excludes: `src/components/ui/**`, `src/integrations/supabase/types.ts`
- **Git hooks:** Husky 9.1.7 + lint-staged 15.2.10
  - `*.{ts,tsx}`: eslint --fix, prettier --write
  - `*.{json,md,css}`: prettier --write
- **Validation script:** `bun run validate` = typecheck + lint + test

## Manual Chunk Split (Vite)

Defined in `vite.config.ts` `manualChunks`:

| Chunk          | Contents                                                     |
| -------------- | ------------------------------------------------------------ |
| `react-vendor` | react, react-dom, react-router-dom                           |
| `data-layer`   | @tanstack/react-query, @supabase/supabase-js                 |
| `radix-ui`     | dialog, dropdown-menu, popover, select, tabs, toast, tooltip |
| `editor`       | @tiptap/react, @tiptap/starter-kit                           |
| `charts`       | recharts                                                     |
| `excel`        | xlsx                                                         |
| `docx`         | docxtemplater, pizzip, file-saver                            |
| `maps`         | react-simple-maps                                            |

## Deployment

- **Hosting:** Vercel — `freire-tax.vercel.app`; auto-deploy on push to `main`
- **SPA routing:** `vercel.json` rewrites `/(.*) -> /index.html`
- **Security headers:** CSP, HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy
- **Source maps:** `hidden` in production (not referenced in bundle; uploadable to Sentry)
- **Required env vars:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

---

_Stack analysis: 2026-05-29_
