import { useMemo } from "react";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsISODate,
  unsafeAsRefreshToken,
} from "../../lib/types/branded.ts";
import type {
  PasskeyInfo,
  Session,
  SsoLinkedAccount,
  TrustedDevice,
} from "../../lib/types/api.ts";
import {
  SecurityPage,
  type SecurityPageApi,
} from "../dashboard/SecurityPage.tsx";
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

function createPreviewApi(): SecurityPageApi {
  let hasPassword = true;
  let totpEnabled = true;
  let nextPasskeyId = 3;
  let passkeys: PasskeyInfo[] = [
    {
      id: "passkey-1",
      credentialId: "preview-credential-1",
      friendlyName: "MacBook Pro",
      createdAt: unsafeAsISODate("2026-07-14T14:30:00.000Z"),
      lastUsed: unsafeAsISODate("2026-09-05T15:42:00.000Z"),
    },
    {
      id: "passkey-2",
      credentialId: "preview-credential-2",
      friendlyName: "Phone",
      createdAt: unsafeAsISODate("2026-08-22T09:15:00.000Z"),
      lastUsed: null,
    },
  ];
  let trustedDevices: TrustedDevice[] = [
    {
      id: "device-1",
      userAgent: "Mozilla/5.0",
      friendlyName: "Firefox on MacBook Pro",
      trustedAt: unsafeAsISODate("2026-08-01T12:00:00.000Z"),
      trustedUntil: unsafeAsISODate("2026-10-30T12:00:00.000Z"),
      lastSeenAt: unsafeAsISODate("2026-09-05T15:50:00.000Z"),
    },
  ];
  let linkedAccounts: SsoLinkedAccount[] = [
    {
      id: "linked-1",
      provider: "github",
      provider_name: "GitHub",
      provider_username: "alice",
      provider_email: "alice@example.com",
      created_at: unsafeAsISODate("2026-06-10T10:00:00.000Z"),
      last_login_at: unsafeAsISODate("2026-09-04T17:00:00.000Z"),
    },
  ];

  return {
    async getPasswordStatus() {
      return { hasPassword };
    },
    async changePassword() {
      hasPassword = true;
    },
    async setPassword() {
      hasPassword = true;
      return { success: true };
    },
    async removePassword() {
      hasPassword = false;
      return { success: true };
    },
    async getTotpStatus() {
      return { enabled: totpEnabled, hasBackupCodes: totpEnabled };
    },
    async createTotpSecret() {
      return {
        uri: "otpauth://totp/Pacifico:alice?secret=PREVIEWONLY123456",
        qrBase64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      };
    },
    async enableTotp() {
      totpEnabled = true;
      return {
        success: true,
        backupCodes: [
          "PREVIEW-1001",
          "PREVIEW-1002",
          "PREVIEW-1003",
          "PREVIEW-1004",
          "PREVIEW-1005",
          "PREVIEW-1006",
        ],
      };
    },
    async disableTotp() {
      totpEnabled = false;
      return { success: true };
    },
    async regenerateBackupCodes() {
      return {
        backupCodes: [
          "PREVIEW-2001",
          "PREVIEW-2002",
          "PREVIEW-2003",
          "PREVIEW-2004",
          "PREVIEW-2005",
          "PREVIEW-2006",
        ],
      };
    },
    async listPasskeys() {
      return { passkeys };
    },
    async startPasskeyRegistration() {
      return {
        options: {
          challenge: new Uint8Array([1]),
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          rp: { name: "Pacifico" },
          user: {
            id: new Uint8Array([1]),
            name: "alice.pacifico.test",
            displayName: "Alice",
          },
        },
      };
    },
    async finishPasskeyRegistration(_token, _credential, friendlyName) {
      const id = `passkey-${nextPasskeyId++}`;
      passkeys = [
        ...passkeys,
        {
          id,
          credentialId: `preview-credential-${id}`,
          friendlyName: friendlyName ?? "Preview passkey",
          createdAt: unsafeAsISODate(new Date().toISOString()),
          lastUsed: null,
        },
      ];
      return { id, credentialId: `preview-credential-${id}` };
    },
    async updatePasskey(_token, id, friendlyName) {
      passkeys = passkeys.map((passkey) =>
        passkey.id === id ? { ...passkey, friendlyName } : passkey,
      );
    },
    async deletePasskey(_token, id) {
      passkeys = passkeys.filter((passkey) => passkey.id !== id);
    },
    async listTrustedDevices() {
      return { devices: trustedDevices };
    },
    async updateTrustedDevice(_token, deviceId, friendlyName) {
      trustedDevices = trustedDevices.map((device) =>
        device.id === deviceId ? { ...device, friendlyName } : device,
      );
      return { success: true };
    },
    async revokeTrustedDevice(_token, deviceId) {
      trustedDevices = trustedDevices.filter(
        (device) => device.id !== deviceId,
      );
      return { success: true };
    },
    async getSsoLinkedAccounts() {
      return { accounts: linkedAccounts };
    },
    async initiateSsoLink() {
      return { redirect_url: "/app/dev/security#linked" };
    },
    async unlinkSsoAccount(_token, id) {
      linkedAccounts = linkedAccounts.filter((account) => account.id !== id);
      return { success: true };
    },
    async getReauthStatus() {
      return {
        requiresReauth: false,
        lastReauthAt: unsafeAsISODate("2026-09-05T15:00:00.000Z"),
        availableMethods: ["password", "totp"],
      };
    },
  };
}

const previewCredential = {
  id: "preview-passkey",
  type: "public-key",
  rawId: "preview-passkey",
  response: {
    clientDataJSON: "preview",
    attestationObject: "preview",
  },
};

export function SecurityPreviewPage() {
  const apiClient = useMemo(() => createPreviewApi(), []);

  return (
    <DashboardPreview path="/app/dev/security" session={previewSession}>
      <SecurityPage
        apiClient={apiClient}
        loadSsoProviders={async () => ({
          providers: [
            { provider: "github", name: "GitHub" },
            { provider: "google", name: "Google" },
          ],
        })}
        registerPasskey={async () => previewCredential}
        navigateTo={() => undefined}
      />
    </DashboardPreview>
  );
}
