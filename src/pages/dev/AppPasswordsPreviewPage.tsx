import { useMemo } from "react";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsISODate,
  unsafeAsRefreshToken,
} from "../../lib/types/branded.ts";
import type { AppPassword, Session } from "../../lib/types/api.ts";
import {
  AppPasswordsPage,
  type AppPasswordsPageApi,
} from "../dashboard/AppPasswordsPage.tsx";
import { DashboardPreview } from "./DashboardPreview.tsx";

const previewSession: Session = {
  did: unsafeAsDid("did:plc:previewaccount"),
  handle: unsafeAsHandle("alice.pacifico.test"),
  accessJwt: unsafeAsAccessToken("preview-access-token"),
  refreshJwt: unsafeAsRefreshToken("preview-refresh-token"),
  contactKind: "email",
  email: unsafeAsEmail("alice@example.com"),
  emailConfirmed: true,
  accountKind: "active",
  isAdmin: false,
};

function createPreviewApi(): AppPasswordsPageApi {
  let passwords: AppPassword[] = [
    {
      name: "Skyfeed on laptop",
      createdAt: unsafeAsISODate("2026-08-18T14:30:00.000Z"),
    },
    {
      name: "Read-only analytics",
      createdAt: unsafeAsISODate("2026-08-29T09:15:00.000Z"),
      scopes:
        "rpc:app.bsky.*?aud=* rpc:chat.bsky.*?aud=* account:status?action=read",
    },
    {
      name: "Posting bot",
      createdAt: unsafeAsISODate("2026-09-02T18:45:00.000Z"),
      scopes: "repo:app.bsky.feed.post?action=create blob:*/*",
      createdByController: "did:plc:previewcontroller",
    },
  ];

  return {
    async listAppPasswords() {
      return { passwords };
    },
    async createAppPassword(_token, name, scopes) {
      const createdAt = unsafeAsISODate(new Date().toISOString());
      passwords = [...passwords, { name, createdAt, scopes }];
      return {
        name,
        password: "preview-only-password-7h3k",
        createdAt,
        scopes,
      };
    },
    async revokeAppPassword(_token, name) {
      passwords = passwords.filter((password) => password.name !== name);
    },
  };
}

export function AppPasswordsPreviewPage() {
  const apiClient = useMemo(() => createPreviewApi(), []);

  return (
    <DashboardPreview path="/app/dev/app-passwords" session={previewSession}>
      <AppPasswordsPage apiClient={apiClient} />
    </DashboardPreview>
  );
}
