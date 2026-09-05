import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const apiTarget = environment.VITE_API_URL || "http://localhost:3000";
  const oauthClientMetadata = readFileSync(
    new URL("./public/oauth-client-metadata.json", import.meta.url),
    "utf8",
  );

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "development-oauth-client-metadata",
        configureServer(server) {
          server.middlewares.use("/oauth-client-metadata.json", (request, response) => {
            const hostname = request.headers.host ?? "localhost:5173";
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(oauthClientMetadata.replaceAll("__FRONTEND_HOSTNAME__", hostname));
          });
        },
      },
    ],
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      port: 5173,
      proxy: {
        "/xrpc": apiTarget,
        "/oauth": apiTarget,
        "/.well-known": apiTarget,
        "/health": apiTarget,
        "/u": apiTarget,
      },
    },
  };
});
