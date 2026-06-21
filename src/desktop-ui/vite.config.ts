import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "path";
import { defineConfig } from "vite";

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
) as { version?: string };
const packageVersion = packageJson.version ?? "0.0.0";

function manualChunks(id: string) {
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("radix-ui") || id.includes("lucide-react")) return "vendor-ui";
  if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
  if (id.includes("@tauri-apps")) return "vendor-tauri";
  if (id.includes("zod")) return "vendor-zod";
  return undefined;
}

export default defineConfig(({ mode }) => {
  const versionLabel =
    mode === "production" ? packageVersion : `${packageVersion} dev`;

  return {
    define: {
      __APP_VERSION_LABEL__: JSON.stringify(versionLabel),
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    resolve: {
      alias: [
        { find: "@va/ui/button", replacement: path.resolve(__dirname, "../shared/ui/src/button.tsx") },
        { find: "@va/ui/dropdown-menu", replacement: path.resolve(__dirname, "../shared/ui/src/dropdown-menu.tsx") },
        { find: "@va/ui/input", replacement: path.resolve(__dirname, "../shared/ui/src/input.tsx") },
        { find: "@va/ui", replacement: path.resolve(__dirname, "../shared/ui/src/index.ts") },
        { find: "@va/i18n", replacement: path.resolve(__dirname, "../shared/i18n/src/index.tsx") },
        { find: "@va/client", replacement: path.resolve(__dirname, "../shared/client-ts/src/index.ts") },
        { find: "@", replacement: path.resolve(__dirname, "./src") },
      ],
    },
    clearScreen: false,
    server: {
      port: 5181,
      strictPort: true,
      proxy: {
        "/tray": {
          target: "http://localhost:5182",
          rewrite: (p) => p.replace(/^\/tray/, ""),
        },
      },
    },
  };
});
