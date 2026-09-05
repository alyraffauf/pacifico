import { useCallback, useState } from "react";
import { ReauthDialog } from "../../components/ReauthDialog.tsx";
import {
  Alert,
  PageHeading,
  SettingsRow,
  SettingsSection,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api, ApiError } from "../../lib/api.ts";
import { createPasskeyCredential } from "../../lib/flows/perform-passkey-registration.ts";
import type { SsoLinkedAccount, TrustedDevice } from "../../lib/types/api.ts";
import {
  SecuritySections,
  type SsoProvider,
  type TotpSetup,
} from "./SecuritySections.tsx";

interface SecurityMessage {
  tone: "success" | "error" | "warning";
  text: string;
}

interface ReauthRequest {
  methods: string[];
  retry: () => Promise<void>;
}

type OptionalResult<T> = { data: T; error?: string };

async function optional<T>(
  request: Promise<T>,
  fallback: T,
  label: string,
): Promise<OptionalResult<T>> {
  try {
    return { data: await request };
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : "request failed";
    return { data: fallback, error: `${label}: ${detail}` };
  }
}

export function SecurityPage() {
  const session = useSession();
  const loadSecurity = useCallback(async () => {
    const [
      password,
      totp,
      passkeys,
      trustedDevices,
      linkedAccounts,
      providers,
    ] = await Promise.all([
      api.getPasswordStatus(session.accessJwt),
      api.getTotpStatus(session.accessJwt),
      api.listPasskeys(session.accessJwt),
      optional(
        api.listTrustedDevices(session.accessJwt),
        { devices: [] },
        "Trusted devices could not be loaded",
      ),
      optional(
        api.getSsoLinkedAccounts(session.accessJwt),
        { accounts: [] },
        "Linked accounts could not be loaded",
      ),
      optional(
        fetch("/oauth/sso/providers").then(async (response) => {
          if (!response.ok)
            throw new Error(`request failed with ${response.status}`);
          return response.json() as Promise<{ providers?: SsoProvider[] }>;
        }),
        { providers: [] },
        "SSO providers could not be loaded",
      ),
    ]);

    return {
      password,
      totp,
      passkeys: passkeys.passkeys,
      trustedDevices: trustedDevices.data.devices,
      linkedAccounts: linkedAccounts.data.accounts,
      providers: (providers.data.providers ?? []).toSorted((left, right) =>
        left.name.localeCompare(right.name),
      ),
      partialErrors: [
        trustedDevices.error,
        linkedAccounts.error,
        providers.error,
      ].filter((value): value is string => Boolean(value)),
    };
  }, [session.accessJwt]);
  const security = useAsync(loadSecurity);

  const [message, setMessage] = useState<SecurityMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const [reauthRequest, setReauthRequest] = useState<ReauthRequest | null>(
    null,
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [totpSetup, setTotpSetup] = useState<TotpSetup>({ step: "idle" });
  const [totpCode, setTotpCode] = useState("");
  const [totpPassword, setTotpPassword] = useState("");
  const [showTotpManager, setShowTotpManager] = useState(false);
  const [showTotpDisable, setShowTotpDisable] = useState(false);
  const [showBackupRegeneration, setShowBackupRegeneration] = useState(false);
  const [backupCodesSaved, setBackupCodesSaved] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [showPasskeyForm, setShowPasskeyForm] = useState(false);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [editedPasskeyName, setEditedPasskeyName] = useState("");
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editedDeviceName, setEditedDeviceName] = useState("");
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);

  function reportError(caught: unknown, fallback: string) {
    setMessage({
      tone: "error",
      text:
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : fallback,
    });
  }

  async function run(action: () => Promise<void>, success?: string) {
    setSaving(true);
    setMessage(null);
    try {
      await action();
      if (success) setMessage({ tone: "success", text: success });
    } catch (caught) {
      reportError(caught, "The account could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function runSensitive(action: () => Promise<void>, success?: string) {
    setSaving(true);
    setMessage(null);
    try {
      await action();
      if (success) setMessage({ tone: "success", text: success });
    } catch (caught) {
      if (caught instanceof ApiError && caught.error === "ReauthRequired") {
        let methods = caught.reauthMethods;
        if (!methods?.length) {
          try {
            methods = (await api.getReauthStatus(session.accessJwt))
              .availableMethods;
          } catch {
            methods = ["password"];
          }
        }
        setReauthRequest({ methods, retry: action });
      } else {
        reportError(caught, "The account could not be updated.");
      }
    } finally {
      setSaving(false);
    }
  }

  function cancelPasswordEditor() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmedPassword("");
    setShowPasswordForm(false);
  }

  function closeTotpEditor() {
    setTotpSetup({ step: "idle" });
    setTotpCode("");
    setTotpPassword("");
    setShowTotpManager(false);
    setShowTotpDisable(false);
    setShowBackupRegeneration(false);
    setBackupCodesSaved(false);
  }

  function cancelPasskeyAdd() {
    setPasskeyName("");
    setShowPasskeyForm(false);
  }

  function cancelPasskeyRename() {
    setEditingPasskeyId(null);
    setEditedPasskeyName("");
  }

  function cancelDeviceRename() {
    setEditingDeviceId(null);
    setEditedDeviceName("");
  }

  function closeAllEditors() {
    setMessage(null);
    cancelPasswordEditor();
    closeTotpEditor();
    cancelPasskeyAdd();
    cancelPasskeyRename();
    cancelDeviceRename();
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmedPassword) {
      setMessage({ tone: "error", text: "The new passwords do not match." });
      return;
    }
    const action = async () => {
      if (security.data?.password.hasPassword) {
        await api.changePassword(
          session.accessJwt,
          currentPassword,
          newPassword,
        );
      } else {
        await api.setPassword(session.accessJwt, newPassword);
      }
      cancelPasswordEditor();
      await security.reload();
    };
    await runSensitive(
      action,
      security.data?.password.hasPassword
        ? "Password changed."
        : "Password added.",
    );
  }

  async function removePassword() {
    if (!confirm("Remove password sign-in from this account?")) return;
    await runSensitive(async () => {
      await api.removePassword(session.accessJwt);
      cancelPasswordEditor();
      await security.reload();
    }, "Password removed.");
  }

  async function startTotpSetup() {
    await run(async () => {
      const result = await api.createTotpSecret(session.accessJwt);
      setTotpSetup({
        step: "scan",
        qrBase64: result.qrBase64,
        uri: result.uri,
      });
    });
  }

  async function enableTotp(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api.enableTotp(
        session.accessJwt,
        totpCode.replace(/\s/g, ""),
      );
      setTotpSetup({ step: "backup", codes: result.backupCodes });
      setTotpCode("");
      setBackupCodesSaved(false);
      await security.reload();
    }, "Authenticator app enabled.");
  }

  async function disableTotp(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.disableTotp(
        session.accessJwt,
        totpPassword,
        totpCode.replace(/\s/g, ""),
      );
      closeTotpEditor();
      await security.reload();
    }, "Authenticator app disabled.");
  }

  async function regenerateBackupCodes(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api.regenerateBackupCodes(
        session.accessJwt,
        totpPassword,
        totpCode.replace(/\s/g, ""),
      );
      setTotpSetup({ step: "backup", codes: result.backupCodes });
      setShowBackupRegeneration(false);
      setTotpPassword("");
      setTotpCode("");
      setBackupCodesSaved(false);
    });
  }

  async function copyBackupCodes(codes: string[]) {
    await navigator.clipboard.writeText(codes.join("\n"));
    setMessage({ tone: "success", text: "Backup codes copied." });
  }

  async function addPasskey() {
    await run(async () => {
      const credential = await createPasskeyCredential(() =>
        api.startPasskeyRegistration(
          session.accessJwt,
          passkeyName.trim() || undefined,
        ),
      );
      await api.finishPasskeyRegistration(
        session.accessJwt,
        credential,
        passkeyName.trim() || undefined,
      );
      cancelPasskeyAdd();
      await security.reload();
    }, "Passkey added.");
  }

  async function renamePasskey() {
    if (!editingPasskeyId || !editedPasskeyName.trim()) return;
    await run(async () => {
      await api.updatePasskey(
        session.accessJwt,
        editingPasskeyId,
        editedPasskeyName.trim(),
      );
      cancelPasskeyRename();
      await security.reload();
    }, "Passkey renamed.");
  }

  async function removePasskey(id: string, name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    await runSensitive(async () => {
      await api.deletePasskey(session.accessJwt, id);
      await security.reload();
    }, "Passkey deleted.");
  }

  async function renameDevice() {
    if (!editingDeviceId || !editedDeviceName.trim()) return;
    await run(async () => {
      await api.updateTrustedDevice(
        session.accessJwt,
        editingDeviceId,
        editedDeviceName.trim(),
      );
      cancelDeviceRename();
      await security.reload();
    }, "Device renamed.");
  }

  async function revokeDevice(device: TrustedDevice) {
    if (!confirm(`Stop trusting ${device.friendlyName || "this device"}?`))
      return;
    await run(async () => {
      await api.revokeTrustedDevice(session.accessJwt, device.id);
      await security.reload();
    }, "Trusted device revoked.");
  }

  async function linkSso(provider: SsoProvider) {
    setLinkingProvider(provider.provider);
    await runSensitive(async () => {
      const result = await api.initiateSsoLink(
        session.accessJwt,
        provider.provider,
        `urn:tranquil:sso:link:${Date.now()}`,
      );
      globalThis.location.assign(result.redirect_url);
    });
    setLinkingProvider(null);
  }

  async function unlinkSso(account: SsoLinkedAccount) {
    if (!confirm(`Unlink ${account.provider_name}?`)) return;
    await runSensitive(async () => {
      await api.unlinkSsoAccount(session.accessJwt, account.id);
      await security.reload();
    }, `${account.provider_name} unlinked.`);
  }

  const heading = (
    <PageHeading
      title="Security"
      description="Manage sign-in methods, two-factor authentication, and trusted access."
    />
  );

  if (security.loading && !security.data) {
    return (
      <div className="mx-auto grid w-full max-w-[52rem] gap-6" aria-busy="true">
        {heading}
        <SettingsSection title="Sign-in methods">
          <SettingsRow label="Password" value="Loading..." />
          <SettingsRow label="Authenticator app" value="Loading..." />
        </SettingsSection>
      </div>
    );
  }

  if (!security.data) {
    return (
      <div className="mx-auto grid w-full max-w-[52rem] gap-6">
        {heading}
        <Alert tone="error">
          {security.error ?? "Security settings could not be loaded."}
        </Alert>
      </div>
    );
  }

  const {
    password,
    totp,
    passkeys,
    trustedDevices,
    linkedAccounts,
    providers,
    partialErrors,
  } = security.data;
  const totpEditorOpen = showTotpManager || totpSetup.step !== "idle";
  const dialogOpen = Boolean(
    showPasswordForm ||
    totpEditorOpen ||
    showPasskeyForm ||
    editingPasskeyId ||
    editingDeviceId,
  );

  return (
    <div className="mx-auto grid w-full max-w-[52rem] gap-6">
      {heading}
      {message && !dialogOpen ? (
        <Alert tone={message.tone}>{message.text}</Alert>
      ) : null}
      {partialErrors.length > 0 ? (
        <Alert tone="warning">{partialErrors.join(" ")}</Alert>
      ) : null}
      <SecuritySections
        saving={saving}
        notice={message}
        password={{
          hasPassword: password.hasPassword,
          canRemove: passkeys.length > 0,
          editorOpen: showPasswordForm,
          currentPassword,
          newPassword,
          confirmedPassword,
          openEditor: () => {
            closeAllEditors();
            setShowPasswordForm(true);
          },
          cancelEditor: cancelPasswordEditor,
          setCurrentPassword,
          setNewPassword,
          setConfirmedPassword,
          save: savePassword,
          remove: () => void removePassword(),
        }}
        authenticator={{
          enabled: totp.enabled,
          editorOpen: totpEditorOpen,
          setup: totpSetup,
          code: totpCode,
          password: totpPassword,
          backupCodesSaved,
          disabling: showTotpDisable,
          regeneratingCodes: showBackupRegeneration,
          openEditor: () => {
            closeAllEditors();
            if (totp.enabled) setShowTotpManager(true);
            else void startTotpSetup();
          },
          closeEditor: closeTotpEditor,
          setCode: setTotpCode,
          setPassword: setTotpPassword,
          setBackupCodesSaved,
          enable: enableTotp,
          disable: disableTotp,
          regenerateCodes: regenerateBackupCodes,
          copyCodes: (codes) => void copyBackupCodes(codes),
          startDisable: () => setShowTotpDisable(true),
          startCodeRegeneration: () => setShowBackupRegeneration(true),
          cancelSensitiveAction: () => {
            setTotpPassword("");
            setTotpCode("");
            setShowTotpDisable(false);
            setShowBackupRegeneration(false);
          },
        }}
        passkeys={{
          items: passkeys,
          hasPassword: password.hasPassword,
          addEditorOpen: showPasskeyForm,
          name: passkeyName,
          editingId: editingPasskeyId,
          editedName: editedPasskeyName,
          openAddEditor: () => {
            closeAllEditors();
            setShowPasskeyForm(true);
          },
          cancelAddEditor: cancelPasskeyAdd,
          setName: setPasskeyName,
          add: () => void addPasskey(),
          startRename: (id, name) => {
            closeAllEditors();
            setEditingPasskeyId(id);
            setEditedPasskeyName(name);
          },
          cancelRename: cancelPasskeyRename,
          setEditedName: setEditedPasskeyName,
          rename: () => void renamePasskey(),
          remove: (id, name) => void removePasskey(id, name),
        }}
        trustedDevices={{
          items: trustedDevices,
          editingId: editingDeviceId,
          editedName: editedDeviceName,
          startRename: (id, name) => {
            closeAllEditors();
            setEditingDeviceId(id);
            setEditedDeviceName(name);
          },
          cancelRename: cancelDeviceRename,
          setEditedName: setEditedDeviceName,
          rename: () => void renameDevice(),
          revoke: (device) => void revokeDevice(device),
        }}
        linkedAccounts={{
          items: linkedAccounts,
          providers,
          linkingProvider,
          link: (provider) => void linkSso(provider),
          unlink: (account) => void unlinkSso(account),
        }}
      />
      {reauthRequest ? (
        <ReauthDialog
          methods={reauthRequest.methods}
          onCancel={() => setReauthRequest(null)}
          onSuccess={async () => {
            const retry = reauthRequest.retry;
            setReauthRequest(null);
            await retry();
            await security.reload();
            setMessage({ tone: "success", text: "Account updated." });
          }}
        />
      ) : null}
    </div>
  );
}
