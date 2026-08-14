import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const runtimePublicFiles = [
  "assets/brand/folio-logo.png",
  "assets/brand/folio-logo-v4.png",
  "assets/brand/folio-cat-avatar.png",
  "assets/pet/folio-cat-done-transparent.png",
  "assets/pet/folio-cat-idle-transparent.png",
  "assets/pet/folio-cat-needs-input-transparent.png",
  "assets/pet/folio-cat-processing-transparent.png",
  "assets/pet/folio-cat-ready-transparent.png",
  "assets/pet/folio-cat-rest-grooming-static-transparent.png",
  "assets/pet/folio-cat-rest-grooming-transparent.webp",
  "assets/pet/folio-cat-welcome-static-transparent.png",
  "assets/pet/folio-cat-welcome-transparent.webp",
  "assets/templates/folio-transaction-import-template.csv",
  "og.png",
];

function copyRuntimePublicAssets() {
  return {
    name: "copy-runtime-public-assets",
    closeBundle() {
      for (const relativePath of runtimePublicFiles) {
        const targetPath = path.resolve("dist/client", relativePath);
        mkdirSync(path.dirname(targetPath), { recursive: true });
        copyFileSync(path.resolve("public", relativePath), targetPath);
      }
    },
  };
}

function servePrivateDevelopmentPreview() {
  return {
    name: "serve-private-development-preview",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__folio_dev/personal-assets", (_request, response) => {
        const sourcePath = path.resolve(".folio-private/personal-assets-preview.json");
        if (!existsSync(sourcePath)) {
          response.statusCode = 404;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: "private_preview_not_found" }));
          return;
        }
        response.statusCode = 200;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(readFileSync(sourcePath, "utf8"));
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  publicDir: command === "serve" ? "public" : false,
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), servePrivateDevelopmentPreview(), copyRuntimePublicAssets()],
}));
