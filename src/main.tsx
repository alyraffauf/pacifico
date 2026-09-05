import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";
import { initializeI18n } from "./lib/i18n.ts";

document.title = globalThis.location.hostname;

await initializeI18n();

const PreviewPage =
  import.meta.env.DEV && globalThis.location.pathname === "/app/dev/settings"
    ? (await import("./pages/dev/SettingsPreviewPage.tsx")).SettingsPreviewPage
    : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {PreviewPage ? (
      <PreviewPage />
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
);
