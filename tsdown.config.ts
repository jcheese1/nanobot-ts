import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/**/*.ts"],
  outDir: "dist",
  format: "esm",
  dts: true,
  unbundle: true,
  clean: true,
  platform: "node",
  target: "es2022",
  sourcemap: true,
});
