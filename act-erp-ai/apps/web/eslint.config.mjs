import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "src/components/ui/**", // shadcn-generated; lint rules differ
    "src/hooks/use-mobile.tsx", // shadcn-generated
    "src/hooks/use-toast.ts", // shadcn-generated
  ]),
]);

export default eslintConfig;
