import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "node22",
  outDir: "dist",
  bundle: true,
  noExternal: ["@sui/db", "@sui/shared"],
  external: ["@prisma/client"],
});
