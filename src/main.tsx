import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";
import { initializeI18n } from "./lib/i18n.ts";

document.title = globalThis.location.hostname;

await initializeI18n();

const PreviewPage = import.meta.env.DEV
  ? globalThis.location.pathname === "/app/dev/settings"
    ? (await import("./pages/dev/SettingsPreviewPage.tsx")).SettingsPreviewPage
    : globalThis.location.pathname === "/app/dev/security"
      ? (await import("./pages/dev/SecurityPreviewPage.tsx"))
          .SecurityPreviewPage
      : globalThis.location.pathname === "/app/dev/sessions"
        ? (await import("./pages/dev/SessionsPreviewPage.tsx"))
            .SessionsPreviewPage
        : globalThis.location.pathname === "/app/dev/app-passwords"
          ? (await import("./pages/dev/AppPasswordsPreviewPage.tsx"))
              .AppPasswordsPreviewPage
          : globalThis.location.pathname === "/app/dev/invite-codes"
            ? (await import("./pages/dev/InviteCodesPreviewPage.tsx"))
                .InviteCodesPreviewPage
            : globalThis.location.pathname === "/app/dev/communication"
              ? (await import("./pages/dev/CommunicationPreviewPage.tsx"))
                  .CommunicationPreviewPage
              : globalThis.location.pathname === "/app/dev/delegation"
                ? (await import("./pages/dev/DelegationPreviewPage.tsx"))
                    .DelegationPreviewPage
                : null
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
