import { useMemo } from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsISODate,
  unsafeAsRefreshToken,
} from "../../lib/types/branded.ts";
import type {
  NotificationHistoryItem,
  NotificationPrefs,
  Session,
} from "../../lib/types/api.ts";
import {
  CommunicationPage,
  type CommunicationPageApi,
} from "../dashboard/CommunicationPage.tsx";

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

const history: NotificationHistoryItem[] = [
  {
    createdAt: unsafeAsISODate("2026-09-05T14:20:00.000Z"),
    channel: "email",
    notificationType: "security_alert",
    status: "delivered",
    subject: "New sign-in to your account",
    body: "A new sign-in was detected from Firefox on macOS.",
  },
  {
    createdAt: unsafeAsISODate("2026-09-02T18:45:00.000Z"),
    channel: "discord",
    notificationType: "password_changed",
    status: "delivered",
    subject: "Your password was changed",
    body: "Your Pacifico account password was changed successfully.",
  },
  {
    createdAt: unsafeAsISODate("2026-08-28T09:15:00.000Z"),
    channel: "email",
    notificationType: "account_notice",
    status: "failed",
    subject: null,
    body: "We could not deliver an account notification.",
  },
];

function createPreviewApi(): CommunicationPageApi {
  let preferences: NotificationPrefs = {
    preferredChannel: "email",
    email: unsafeAsEmail("alice@example.com"),
    discordUsername: "alice",
    discordVerified: true,
    telegramUsername: null,
    telegramVerified: false,
    signalUsername: null,
    signalVerified: false,
  };

  return {
    async getNotificationPrefs() {
      return preferences;
    },
    async describeServer() {
      return {
        availableUserDomains: [".pacifico.test"],
        inviteCodeRequired: false,
        did: "did:web:pacifico.test",
        availableCommsChannels: ["email", "discord", "telegram", "signal"],
        discordBotUsername: "PacificoBot",
        discordAppId: "1234567890",
        telegramBotUsername: "pacifico_preview_bot",
      };
    },
    async getNotificationHistory() {
      return { notifications: history };
    },
    async updateNotificationPrefs(_token, updates) {
      const changedChannels: string[] = [];
      if (updates.discordUsername !== undefined) {
        preferences = {
          ...preferences,
          discordUsername: updates.discordUsername,
          discordVerified: false,
        };
        changedChannels.push("discord");
      }
      if (updates.telegramUsername !== undefined) {
        preferences = {
          ...preferences,
          telegramUsername: updates.telegramUsername,
          telegramVerified: false,
        };
        changedChannels.push("telegram");
      }
      if (updates.signalUsername !== undefined) {
        preferences = {
          ...preferences,
          signalUsername: updates.signalUsername,
          signalVerified: false,
        };
        changedChannels.push("signal");
      }
      const preferredChannel = updates.preferredChannel;
      if (
        preferredChannel === "email" ||
        preferredChannel === "discord" ||
        preferredChannel === "telegram" ||
        preferredChannel === "signal"
      ) {
        preferences = { ...preferences, preferredChannel };
      }
      return { success: true, verificationRequired: changedChannels };
    },
    async checkChannelVerified() {
      return { verified: false };
    },
    async confirmChannelVerification(_token, channel) {
      if (channel === "discord")
        preferences = { ...preferences, discordVerified: true };
      if (channel === "telegram")
        preferences = { ...preferences, telegramVerified: true };
      if (channel === "signal")
        preferences = { ...preferences, signalVerified: true };
      return { success: true };
    },
  };
}

export function CommunicationPreviewPage() {
  const apiClient = useMemo(() => createPreviewApi(), []);

  return (
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={previewSession} />}>
          <Route
            index
            element={
              <main className="min-h-screen bg-ctp-base px-4 py-8 text-ctp-text sm:px-6">
                <div className="mx-auto grid max-w-[52rem] gap-6">
                  <div className="rounded border border-ctp-blue/40 bg-ctp-blue/10 px-4 py-3 font-mono text-xs text-ctp-blue">
                    Development preview at /app/dev/communication. Changes stay
                    in this tab.
                  </div>
                  <CommunicationPage
                    apiClient={apiClient}
                    refreshAccountSession={async () => undefined}
                  />
                </div>
              </main>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}
