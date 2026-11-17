import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";

const replacements = new Map([
  [resolve("src/security/GoogleProvider"), resolve("src/streamlit/GoogleProvider.tsx")],
  [resolve("src/security/google-session"), resolve("src/streamlit/google-session.ts")],
  [resolve("src/security/SecurityLayout"), resolve("src/streamlit/Layout.tsx")],
]);
export default defineConfig({
  root: "streamlit_frontend", base: "./", publicDir: false,
  plugins: [{ name: "ggsafe-streamlit-adapters", enforce: "pre", resolveId(source, importer) {
    if (!importer || !source.startsWith(".")) return;
    return replacements.get(resolve(dirname(importer), source).replace(/\.(tsx?|jsx?)$/, ""));
  } }, react(), tailwindcss()],
  build: { outDir: "../ggsafe_streamlit/ui", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 600 },
});
