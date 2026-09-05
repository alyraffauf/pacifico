import { useState } from "react";
import {
  IconCopy,
  IconDeviceLaptop,
  IconEdit,
  IconKey,
  IconLink,
  IconLock,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";
import { ReauthDialog } from "../../components/ReauthDialog.tsx";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loading,
  PageHeading,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api, ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/date.ts";
import { createPasskeyCredential } from "../../lib/flows/perform-passkey-registration.ts";
import type { SsoLinkedAccount, TrustedDevice } from "../../lib/types/api.ts";

interface SsoProvider {
  provider: string;
  name: string;
}

interface SecurityMessage {
  tone: "success" | "error" | "warning";
  text: string;
}

interface ReauthRequest {
  methods: string[];
  retry: () => Promise<void>;
}

type TotpSetup =
  | { step: "idle" }
  | { step: "scan"; qrBase64: string; uri: string }
  | { step: "backup"; codes: string[] };

type OptionalResult<T> = { data: T; error?: string };

async function optional<T>(request: Promise<T>, fallback: T, label: string): Promise<OptionalResult<T>> {
  try {
    return { data: await request };
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : "request failed";
    return { data: fallback, error: `${label}: ${detail}` };
  }
}

export function SecurityPage() {
  const session = useSession();
  const security = useAsync(async () => {
    const [password, totp, passkeys, trustedDevices, linkedAccounts, providers] = await Promise.all([
      api.getPasswordStatus(session.accessJwt),
      api.getTotpStatus(session.accessJwt),
      api.listPasskeys(session.accessJwt),
      optional(api.listTrustedDevices(session.accessJwt), { devices: [] }, "Trusted devices could not be loaded"),
      optional(api.getSsoLinkedAccounts(session.accessJwt), { accounts: [] }, "Linked accounts could not be loaded"),
      optional(
        fetch("/oauth/sso/providers")
          .then(async (response) => {
            if (!response.ok) throw new Error(`request failed with ${response.status}`);
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
      providers: (providers.data.providers ?? []).toSorted((left, right) => left.name.localeCompare(right.name)),
      partialErrors: [trustedDevices.error, linkedAccounts.error, providers.error].filter((value): value is string => Boolean(value)),
    };
  }, [session.accessJwt]);

  const [message, setMessage] = useState<SecurityMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const [reauthRequest, setReauthRequest] = useState<ReauthRequest | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const [totpSetup, setTotpSetup] = useState<TotpSetup>({ step: "idle" });
  const [totpCode, setTotpCode] = useState("");
  const [totpPassword, setTotpPassword] = useState("");
  const [showTotpDisable, setShowTotpDisable] = useState(false);
  const [showBackupRegeneration, setShowBackupRegeneration] = useState(false);
  const [backupCodesSaved, setBackupCodesSaved] = useState(false);

  const [passkeyName, setPasskeyName] = useState("");
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [editedPasskeyName, setEditedPasskeyName] = useState("");

  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editedDeviceName, setEditedDeviceName] = useState("");
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);

  function reportError(caught: unknown, fallback: string) {
    setMessage({
      tone: "error",
      text: caught instanceof ApiError || caught instanceof Error ? caught.message : fallback,
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
            methods = (await api.getReauthStatus(session.accessJwt)).availableMethods;
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

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmedPassword) {
      setMessage({ tone: "error", text: "The new passwords do not match." });
      return;
    }
    const action = async () => {
      if (security.data?.password.hasPassword) {
        await api.changePassword(session.accessJwt, currentPassword, newPassword);
      } else {
        await api.setPassword(session.accessJwt, newPassword);
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmedPassword("");
      setShowPasswordForm(false);
      await security.reload();
    };
    await runSensitive(action, security.data?.password.hasPassword ? "Password changed." : "Password added.");
  }

  async function removePassword() {
    if (!confirm("Remove password sign-in from this account?")) return;
    await runSensitive(async () => {
      await api.removePassword(session.accessJwt);
      await security.reload();
    }, "Password removed.");
  }

  async function startTotpSetup() {
    await run(async () => {
      const result = await api.createTotpSecret(session.accessJwt);
      setTotpSetup({ step: "scan", qrBase64: result.qrBase64, uri: result.uri });
    });
  }

  async function enableTotp(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api.enableTotp(session.accessJwt, totpCode.replace(/\s/g, ""));
      setTotpSetup({ step: "backup", codes: result.backupCodes });
      setTotpCode("");
      setBackupCodesSaved(false);
      await security.reload();
    }, "Authenticator app enabled.");
  }

  async function disableTotp(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.disableTotp(session.accessJwt, totpPassword, totpCode.replace(/\s/g, ""));
      setShowTotpDisable(false);
      setTotpPassword("");
      setTotpCode("");
      await security.reload();
    }, "Authenticator app disabled.");
  }

  async function regenerateBackupCodes(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api.regenerateBackupCodes(session.accessJwt, totpPassword, totpCode.replace(/\s/g, ""));
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
        api.startPasskeyRegistration(session.accessJwt, passkeyName.trim() || undefined),
      );
      await api.finishPasskeyRegistration(session.accessJwt, credential, passkeyName.trim() || undefined);
      setPasskeyName("");
      await security.reload();
    }, "Passkey added.");
  }

  async function renamePasskey() {
    if (!editingPasskeyId || !editedPasskeyName.trim()) return;
    await run(async () => {
      await api.updatePasskey(session.accessJwt, editingPasskeyId, editedPasskeyName.trim());
      setEditingPasskeyId(null);
      setEditedPasskeyName("");
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
      await api.updateTrustedDevice(session.accessJwt, editingDeviceId, editedDeviceName.trim());
      setEditingDeviceId(null);
      setEditedDeviceName("");
      await security.reload();
    }, "Device renamed.");
  }

  async function revokeDevice(device: TrustedDevice) {
    if (!confirm(`Stop trusting ${device.friendlyName || "this device"}?`)) return;
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

  if (security.loading) {
    return <Loading label="Loading security settings" />;
  }

  if (!security.data) {
    return <Alert tone="error">{security.error ?? "Security settings could not be loaded."}</Alert>;
  }

  const { password, totp, passkeys, trustedDevices, linkedAccounts, providers, partialErrors } = security.data;

  return (
    <div className="grid gap-6">
      <PageHeading title="Security" description="Choose how you sign in and review devices with account access." />
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {partialErrors.length > 0 ? <Alert tone="warning">{partialErrors.join(" ")}</Alert> : null}

      <Card className="p-5">
        <SectionTitle icon={IconLock} title="Password" />
        <p className="mt-2 text-sm text-ctp-subtext-0">
          {password.hasPassword ? "Password sign-in is enabled." : "This account has no password."}
        </p>
        {showPasswordForm ? (
          <form className="mt-5 grid max-w-xl gap-4" onSubmit={savePassword}>
            {password.hasPassword ? (
              <Field label="Current password"><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></Field>
            ) : null}
            <Field label="New password"><Input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required /></Field>
            <Field label="Confirm new password"><Input type="password" minLength={8} value={confirmedPassword} onChange={(event) => setConfirmedPassword(event.target.value)} autoComplete="new-password" required /></Field>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowPasswordForm(false)}>Cancel</Button>
              <Button disabled={saving || newPassword.length < 8 || !confirmedPassword}>{password.hasPassword ? "Change password" : "Add password"}</Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setShowPasswordForm(true)}>{password.hasPassword ? "Change password" : "Add password"}</Button>
            {password.hasPassword && passkeys.length > 0 ? <Button variant="danger" onClick={() => void removePassword()}>Remove password</Button> : null}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle icon={IconShieldCheck} title="Authenticator app" />
        {totpSetup.step === "scan" ? (
          <form className="mt-4 grid max-w-xl gap-4" onSubmit={enableTotp}>
            <p className="text-sm text-ctp-subtext-0">Scan this code, then enter the six-digit number from your authenticator app.</p>
            <img className="size-48 rounded bg-white p-2" src={`data:image/png;base64,${totpSetup.qrBase64}`} alt="Authenticator QR code" />
            <details className="text-sm text-ctp-subtext-0"><summary>Enter the secret manually</summary><code className="mt-2 block break-all rounded bg-ctp-crust p-3 text-xs text-ctp-text">{new URL(totpSetup.uri).searchParams.get("secret")}</code></details>
            <Field label="Authenticator code"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value)} required /></Field>
            <div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => setTotpSetup({ step: "idle" })}>Cancel</Button><Button disabled={saving || totpCode.replace(/\s/g, "").length !== 6}>Enable</Button></div>
          </form>
        ) : totpSetup.step === "backup" ? (
          <div className="mt-4 grid max-w-xl gap-4">
            <Alert tone="warning">Save these one-time backup codes before closing this panel.</Alert>
            <pre className="code-block columns-2">{totpSetup.codes.join("\n")}</pre>
            <Button variant="secondary" onClick={() => void copyBackupCodes(totpSetup.codes)}><IconCopy className="size-4" /> Copy codes</Button>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={backupCodesSaved} onChange={(event) => setBackupCodesSaved(event.target.checked)} /> I saved the codes.</label>
            <Button disabled={!backupCodesSaved} onClick={() => setTotpSetup({ step: "idle" })}>Done</Button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-ctp-subtext-0">{totp.enabled ? "Authenticator codes are required for sensitive sign-ins." : "Add a second factor using any TOTP authenticator app."}</p>
            {!totp.enabled ? <Button className="mt-4" onClick={() => void startTotpSetup()} disabled={saving}>Set up authenticator</Button> : (
              <div className="mt-4 grid max-w-xl gap-4">
                {!showTotpDisable && !showBackupRegeneration ? <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setShowBackupRegeneration(true)}>New backup codes</Button><Button variant="danger" onClick={() => setShowTotpDisable(true)}>Disable authenticator</Button></div> : null}
                {showTotpDisable || showBackupRegeneration ? (
                  <form className="grid gap-4 rounded border border-ctp-surface-0 bg-ctp-crust p-4" onSubmit={showTotpDisable ? disableTotp : regenerateBackupCodes}>
                    <p className="text-sm text-ctp-subtext-0">Enter your password and current authenticator code.</p>
                    <Field label="Password"><Input type="password" value={totpPassword} onChange={(event) => setTotpPassword(event.target.value)} required /></Field>
                    <Field label="Authenticator code"><Input inputMode="numeric" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value)} required /></Field>
                    <div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => { setShowTotpDisable(false); setShowBackupRegeneration(false); }}>Cancel</Button><Button variant={showTotpDisable ? "danger" : "primary"} disabled={saving || !totpPassword || totpCode.length !== 6}>{showTotpDisable ? "Disable" : "Generate codes"}</Button></div>
                  </form>
                ) : null}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle icon={IconKey} title="Passkeys" />
        <div className="mt-4 flex max-w-xl flex-col gap-2 sm:flex-row">
          <Input value={passkeyName} onChange={(event) => setPasskeyName(event.target.value)} placeholder="Name this device" aria-label="Passkey name" />
          <Button onClick={() => void addPasskey()} disabled={saving}>Add passkey</Button>
        </div>
        <div className="mt-5 grid gap-2">
          {passkeys.length === 0 ? <EmptyState>No passkeys registered.</EmptyState> : passkeys.map((passkey) => (
            <div key={passkey.id} className="flex flex-col gap-3 rounded border border-ctp-surface-0 bg-ctp-crust p-3 sm:flex-row sm:items-center sm:justify-between">
              {editingPasskeyId === passkey.id ? (
                <div className="flex flex-1 gap-2"><Input value={editedPasskeyName} onChange={(event) => setEditedPasskeyName(event.target.value)} autoFocus /><Button onClick={() => void renamePasskey()}>Save</Button><Button variant="ghost" onClick={() => setEditingPasskeyId(null)}>Cancel</Button></div>
              ) : (
                <><div><p className="font-mono text-sm text-ctp-text">{passkey.friendlyName || "Unnamed passkey"}</p><p className="mt-1 text-xs text-ctp-overlay-1">Added {formatDateTime(passkey.createdAt)}{passkey.lastUsed ? ` · Used ${formatDateTime(passkey.lastUsed)}` : ""}</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => { setEditingPasskeyId(passkey.id); setEditedPasskeyName(passkey.friendlyName ?? ""); }}><IconEdit className="size-4" /> Rename</Button>{password.hasPassword || passkeys.length > 1 ? <Button variant="danger" onClick={() => void removePasskey(passkey.id, passkey.friendlyName || "this passkey")}><IconTrash className="size-4" /> Delete</Button> : null}</div></>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle icon={IconDeviceLaptop} title="Trusted devices" />
        <div className="mt-4 grid gap-2">
          {trustedDevices.length === 0 ? <EmptyState>No trusted devices.</EmptyState> : trustedDevices.map((device) => (
            <div key={device.id} className="flex flex-col gap-3 rounded border border-ctp-surface-0 bg-ctp-crust p-3 sm:flex-row sm:items-center sm:justify-between">
              {editingDeviceId === device.id ? (
                <div className="flex flex-1 gap-2"><Input value={editedDeviceName} onChange={(event) => setEditedDeviceName(event.target.value)} autoFocus /><Button onClick={() => void renameDevice()}>Save</Button><Button variant="ghost" onClick={() => setEditingDeviceId(null)}>Cancel</Button></div>
              ) : (
                <><div><p className="font-mono text-sm text-ctp-text">{device.friendlyName || "Unnamed device"}</p><p className="mt-1 text-xs text-ctp-overlay-1">Last seen {formatDateTime(device.lastSeenAt)}</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => { setEditingDeviceId(device.id); setEditedDeviceName(device.friendlyName ?? ""); }}><IconEdit className="size-4" /> Rename</Button><Button variant="danger" onClick={() => void revokeDevice(device)}>Revoke</Button></div></>
              )}
            </div>
          ))}
        </div>
      </Card>

      {providers.length > 0 || linkedAccounts.length > 0 ? (
        <Card className="p-5">
          <SectionTitle icon={IconLink} title="Linked sign-in accounts" />
          <div className="mt-4 grid gap-2">
            {linkedAccounts.map((account) => <div key={account.id} className="flex items-center justify-between gap-4 rounded border border-ctp-surface-0 bg-ctp-crust p-3"><div><p className="font-mono text-sm text-ctp-text">{account.provider_name}</p><p className="mt-1 text-xs text-ctp-overlay-1">{account.provider_username || account.provider_email}</p></div><Button variant="danger" onClick={() => void unlinkSso(account)}>Unlink</Button></div>)}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {providers.filter((provider) => !linkedAccounts.some((account) => account.provider === provider.provider)).map((provider) => <Button key={provider.provider} variant="secondary" disabled={linkingProvider !== null} onClick={() => void linkSso(provider)}>Link {provider.name}</Button>)}
          </div>
        </Card>
      ) : null}

      {reauthRequest ? <ReauthDialog methods={reauthRequest.methods} onCancel={() => setReauthRequest(null)} onSuccess={async () => { const retry = reauthRequest.retry; setReauthRequest(null); await retry(); await security.reload(); setMessage({ tone: "success", text: "Account updated." }); }} /> : null}
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof IconLock; title: string }) {
  return <h2 className="flex items-center gap-2 font-mono text-base font-semibold text-ctp-text"><Icon className="size-5 text-ctp-lavender" aria-hidden="true" />{title}</h2>;
}
