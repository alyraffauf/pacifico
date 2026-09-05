import { useMemo } from "react";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsISODate,
  unsafeAsRefreshToken,
} from "../../lib/types/branded.ts";
import type { Session, SessionInfo } from "../../lib/types/api.ts";
import {
  SessionsPage,
  type SessionsPageApi,
} from "../dashboard/SessionsPage.tsx";
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

function createPreviewApi(): SessionsPageApi {
  let sessions: SessionInfo[] = [
    {
      id: "session-current",
      sessionType: "oauth",
      clientName: "Pacifico Account",
      createdAt: unsafeAsISODate("2026-09-05T13:20:00.000Z"),
      expiresAt: unsafeAsISODate("2026-09-05T14:20:00.000Z"),
      isCurrent: true,
    },
    {
      id: "session-skywriter",
      sessionType: "oauth",
      clientName: "Skywriter",
      createdAt: unsafeAsISODate("2026-09-03T18:10:00.000Z"),
      expiresAt: unsafeAsISODate("2026-09-10T18:10:00.000Z"),
      isCurrent: false,
    },
    {
      id: "session-legacy",
      sessionType: "legacy",
      clientName: null,
      createdAt: unsafeAsISODate("2026-08-28T09:45:00.000Z"),
      expiresAt: unsafeAsISODate("2026-09-27T09:45:00.000Z"),
      isCurrent: false,
    },
    {
      id: "session-app-password",
      sessionType: "app_password",
      clientName: "Feed Reader",
      createdAt: unsafeAsISODate("2026-08-12T16:30:00.000Z"),
      expiresAt: unsafeAsISODate("2027-08-12T16:30:00.000Z"),
      isCurrent: false,
    },
  ];

  return {
    async listSessions() {
      return { sessions };
    },
    async revokeSession(_token, sessionId) {
      sessions = sessions.filter((session) => session.id !== sessionId);
    },
    async revokeAllSessions() {
      const revokedCount = sessions.filter(
        (session) => !session.isCurrent,
      ).length;
      sessions = sessions.filter((session) => session.isCurrent);
      return { revokedCount };
    },
  };
}

export function SessionsPreviewPage() {
  const apiClient = useMemo(() => createPreviewApi(), []);

  return (
    <DashboardPreview path="/app/dev/sessions" session={previewSession}>
      <SessionsPage
        apiClient={apiClient}
        signOut={async () => undefined}
        onCurrentSessionRevoked={() => undefined}
      />
    </DashboardPreview>
  );
}
