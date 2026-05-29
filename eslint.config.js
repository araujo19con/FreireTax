import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "supabase/functions/**", "tools/**", "fix-template.mjs"] },
  {
    // Tier 1: regras leves aplicadas a todos os arquivos TS/TSX.
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Já é warn no preset recommended — explicito pra documentar intenção.
      // Há ~117 ocorrências no código atual; novos casts pra `any` continuam
      // visíveis no review e podem ser migrados gradualmente.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Tier 2: regras type-aware (precisam de TypeProject) — só pra src/, evita
    // o custo de typecheck duplo em scripts e edge functions.
    files: ["src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Catch `void supabase.from(...).update(...)` sem await — categoria de
      // bug que escorrega fácil no review.
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/await-thenable": "warn",
      // Os checks type-aware abaixo ainda têm muitos hits no código legado —
      // mantidos como off por enquanto pra não poluir o sinal das duas regras
      // acima. Reativar conforme `any`s forem reduzidos.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
