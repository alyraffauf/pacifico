import { useRef, type FormEventHandler } from "react";
import { IconCopy, IconEdit, IconTrash } from "@tabler/icons-react";
import {
  Alert,
  Button,
  CodeBlock,
  Field,
  Input,
  SettingsDialog,
  SettingsItem,
  SettingsRow,
  SettingsSection,
} from "../../components/ui.tsx";
import { formatDateTime } from "../../lib/date.ts";
import type {
  PasskeyInfo,
  SsoLinkedAccount,
  TrustedDevice,
} from "../../lib/types/api.ts";

export interface SsoProvider {
  provider: string;
  name: string;
}

export type TotpSetup =
  | { step: "idle" }
  | { step: "scan"; qrBase64: string; uri: string }
  | { step: "backup"; codes: string[] };

export interface SecurityNotice {
  tone: "success" | "error" | "warning";
  text: string;
}

interface PasswordSettings {
  hasPassword: boolean;
  canRemove: boolean;
  editorOpen: boolean;
  currentPassword: string;
  newPassword: string;
  confirmedPassword: string;
  openEditor: () => void;
  cancelEditor: () => void;
  setCurrentPassword: (value: string) => void;
  setNewPassword: (value: string) => void;
  setConfirmedPassword: (value: string) => void;
  save: FormEventHandler<HTMLFormElement>;
  remove: () => void;
}

interface AuthenticatorSettings {
  enabled: boolean;
  editorOpen: boolean;
  setup: TotpSetup;
  code: string;
  password: string;
  backupCodesSaved: boolean;
  disabling: boolean;
  regeneratingCodes: boolean;
  openEditor: () => void;
  closeEditor: () => void;
  setCode: (value: string) => void;
  setPassword: (value: string) => void;
  setBackupCodesSaved: (value: boolean) => void;
  enable: FormEventHandler<HTMLFormElement>;
  disable: FormEventHandler<HTMLFormElement>;
  regenerateCodes: FormEventHandler<HTMLFormElement>;
  copyCodes: (codes: string[]) => void;
  startDisable: () => void;
  startCodeRegeneration: () => void;
  cancelSensitiveAction: () => void;
}

interface PasskeySettings {
  items: PasskeyInfo[];
  hasPassword: boolean;
  addEditorOpen: boolean;
  name: string;
  editingId: string | null;
  editedName: string;
  openAddEditor: () => void;
  cancelAddEditor: () => void;
  setName: (value: string) => void;
  add: () => void;
  startRename: (id: string, name: string) => void;
  cancelRename: () => void;
  setEditedName: (value: string) => void;
  rename: () => void;
  remove: (id: string, name: string) => void;
}

interface TrustedDeviceSettings {
  items: TrustedDevice[];
  editingId: string | null;
  editedName: string;
  startRename: (id: string, name: string) => void;
  cancelRename: () => void;
  setEditedName: (value: string) => void;
  rename: () => void;
  revoke: (device: TrustedDevice) => void;
}

interface LinkedAccountSettings {
  items: SsoLinkedAccount[];
  providers: SsoProvider[];
  linkingProvider: string | null;
  link: (provider: SsoProvider) => void;
  unlink: (account: SsoLinkedAccount) => void;
}

interface SecuritySectionsProps {
  saving: boolean;
  notice: SecurityNotice | null;
  password: PasswordSettings;
  authenticator: AuthenticatorSettings;
  passkeys: PasskeySettings;
  trustedDevices: TrustedDeviceSettings;
  linkedAccounts: LinkedAccountSettings;
}

function DialogNotice({ notice }: { notice: SecurityNotice | null }) {
  return notice ? (
    <div className="mb-4">
      <Alert tone={notice.tone}>{notice.text}</Alert>
    </div>
  ) : null;
}

function PasswordSettingsRow({
  saving,
  notice,
  settings,
}: {
  saving: boolean;
  notice: SecurityNotice | null;
  settings: PasswordSettings;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <SettingsRow
        label="Password"
        value={settings.hasPassword ? "Enabled" : "Not set"}
        description={
          settings.hasPassword
            ? "Use your account password to sign in."
            : "This passkey-only account has no password."
        }
        action={
          <Button
            type="button"
            variant="ghost"
            size="compact"
            aria-haspopup="dialog"
            aria-expanded={settings.editorOpen}
            onClick={settings.openEditor}
          >
            {settings.hasPassword ? "Change" : "Add"}
          </Button>
        }
      />
      <SettingsDialog
        open={settings.editorOpen}
        title={settings.hasPassword ? "Change password" : "Add password"}
        description="Use at least 8 characters."
        initialFocusRef={inputRef}
        closeDisabled={saving}
        onClose={settings.cancelEditor}
      >
        <DialogNotice notice={notice} />
        <form className="grid gap-4" onSubmit={settings.save}>
          {settings.hasPassword ? (
            <Field label="Current password">
              <Input
                ref={inputRef}
                type="password"
                value={settings.currentPassword}
                onChange={(event) =>
                  settings.setCurrentPassword(event.target.value)
                }
                autoComplete="current-password"
                disabled={saving}
                required
              />
            </Field>
          ) : null}
          <Field label="New password">
            <Input
              ref={settings.hasPassword ? undefined : inputRef}
              type="password"
              minLength={8}
              value={settings.newPassword}
              onChange={(event) => settings.setNewPassword(event.target.value)}
              autoComplete="new-password"
              disabled={saving}
              required
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              minLength={8}
              value={settings.confirmedPassword}
              onChange={(event) =>
                settings.setConfirmedPassword(event.target.value)
              }
              autoComplete="new-password"
              disabled={saving}
              required
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            {settings.hasPassword && settings.canRemove ? (
              <Button
                type="button"
                variant="dangerOutline"
                className="mr-auto"
                disabled={saving}
                onClick={settings.remove}
              >
                Remove password
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={settings.cancelEditor}
            >
              Cancel
            </Button>
            <Button
              disabled={
                saving ||
                settings.newPassword.length < 8 ||
                !settings.confirmedPassword
              }
            >
              {settings.hasPassword ? "Change password" : "Add password"}
            </Button>
          </div>
        </form>
      </SettingsDialog>
    </>
  );
}

function AuthenticatorSettingsRow({
  saving,
  notice,
  settings,
}: {
  saving: boolean;
  notice: SecurityNotice | null;
  settings: AuthenticatorSettings;
}) {
  const { setup } = settings;
  const codeInputRef = useRef<HTMLInputElement>(null);
  const dialogTitle =
    setup.step === "scan"
      ? "Set up authenticator"
      : setup.step === "backup"
        ? "Save backup codes"
        : settings.disabling
          ? "Disable authenticator"
          : settings.regeneratingCodes
            ? "Generate new backup codes"
            : "Manage authenticator";
  return (
    <>
      <SettingsRow
        label="Authenticator app"
        value={settings.enabled ? "Enabled" : "Not set"}
        description={
          settings.enabled
            ? "A six-digit code protects sensitive sign-ins."
            : "Add a second factor with any TOTP authenticator app."
        }
        action={
          <Button
            type="button"
            variant="ghost"
            size="compact"
            aria-haspopup="dialog"
            aria-expanded={settings.editorOpen}
            disabled={saving}
            onClick={settings.openEditor}
          >
            {settings.enabled ? "Manage" : "Set up"}
          </Button>
        }
      />
      <SettingsDialog
        open={settings.editorOpen}
        title={dialogTitle}
        initialFocusRef={setup.step === "scan" ? codeInputRef : undefined}
        maxWidth={setup.step === "scan" ? "lg" : "md"}
        closeDisabled={saving}
        onClose={settings.closeEditor}
      >
        <DialogNotice notice={notice} />
        <div>
          {setup.step === "scan" ? (
            <form className="grid gap-5" onSubmit={settings.enable}>
              <p className="text-sm leading-6 text-ctp-subtext0">
                Scan the QR code, then enter the six-digit number from your
                authenticator app.
              </p>
              <div className="grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
                <img
                  className="size-48 max-w-full rounded bg-white p-2"
                  src={`data:image/png;base64,${setup.qrBase64}`}
                  alt="Authenticator QR code"
                />
                <div className="grid min-w-0 gap-4">
                  <Field label="Authenticator code">
                    <Input
                      ref={codeInputRef}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={settings.code}
                      onChange={(event) => settings.setCode(event.target.value)}
                      placeholder="6 digits"
                      disabled={saving}
                      required
                    />
                  </Field>
                  <details className="text-xs leading-5 text-ctp-subtext0">
                    <summary className="cursor-pointer">
                      Enter the secret manually
                    </summary>
                    <code className="mt-2 block rounded border border-ctp-surface0 bg-ctp-crust p-3 font-mono break-all text-ctp-text">
                      {new URL(setup.uri).searchParams.get("secret")}
                    </code>
                  </details>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    saving || settings.code.replace(/\s/g, "").length !== 6
                  }
                >
                  Enable authenticator
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={settings.closeEditor}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : setup.step === "backup" ? (
            <div className="grid gap-4">
              <Alert tone="warning">
                Save these one-time backup codes before closing this panel.
              </Alert>
              <CodeBlock className="columns-1 sm:columns-2">
                {setup.codes.join("\n")}
              </CodeBlock>
              <Button
                type="button"
                variant="secondary"
                className="justify-self-start"
                onClick={() => settings.copyCodes(setup.codes)}
              >
                <IconCopy className="size-4" aria-hidden="true" /> Copy codes
              </Button>
              <label className="flex items-center gap-2 text-sm text-ctp-subtext1">
                <input
                  type="checkbox"
                  checked={settings.backupCodesSaved}
                  onChange={(event) =>
                    settings.setBackupCodesSaved(event.target.checked)
                  }
                />
                I saved the codes.
              </label>
              <Button
                className="justify-self-start"
                disabled={!settings.backupCodesSaved}
                onClick={settings.closeEditor}
              >
                Done
              </Button>
            </div>
          ) : settings.disabling || settings.regeneratingCodes ? (
            <form
              className="grid gap-4"
              onSubmit={
                settings.disabling ? settings.disable : settings.regenerateCodes
              }
            >
              <p className="text-sm leading-6 text-ctp-subtext0">
                Enter your password and a current authenticator code to
                continue.
              </p>
              <Field label="Password">
                <Input
                  type="password"
                  value={settings.password}
                  onChange={(event) => settings.setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={saving}
                  required
                />
              </Field>
              <Field label="Authenticator code">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={settings.code}
                  onChange={(event) => settings.setCode(event.target.value)}
                  placeholder="6 digits"
                  disabled={saving}
                  required
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={settings.disabling ? "dangerOutline" : "primary"}
                  disabled={
                    saving ||
                    !settings.password ||
                    settings.code.replace(/\s/g, "").length !== 6
                  }
                >
                  {settings.disabling
                    ? "Disable authenticator"
                    : "Generate codes"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={settings.cancelSensitiveAction}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-4">
              <p className="text-sm leading-6 text-ctp-subtext0">
                Generate replacement backup codes or turn off the authenticator
                requirement.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={settings.startCodeRegeneration}
                >
                  New backup codes
                </Button>
                <Button
                  type="button"
                  variant="dangerOutline"
                  onClick={settings.startDisable}
                >
                  Disable authenticator
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={settings.closeEditor}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </SettingsDialog>
    </>
  );
}

function PasskeySection({
  saving,
  notice,
  settings,
}: {
  saving: boolean;
  notice: SecurityNotice | null;
  settings: PasskeySettings;
}) {
  const addInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const passkeyBeingRenamed = settings.items.find(
    (passkey) => passkey.id === settings.editingId,
  );
  return (
    <>
      <SettingsSection
        title="Passkeys"
        description="Use your fingerprint, face, or device PIN to sign in without entering a password."
      >
        {settings.items.map((passkey) => {
          const name = passkey.friendlyName || "Unnamed passkey";
          return (
            <SettingsItem
              key={passkey.id}
              title={name}
              technical
              description={
                <>
                  Added {formatDateTime(passkey.createdAt)}
                  {passkey.lastUsed
                    ? ` · Last used ${formatDateTime(passkey.lastUsed)}`
                    : ""}
                </>
              }
              action={
                <div className="flex flex-wrap justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    aria-haspopup="dialog"
                    aria-expanded={settings.editingId === passkey.id}
                    onClick={() => settings.startRename(passkey.id, name)}
                  >
                    <IconEdit className="size-4" aria-hidden="true" /> Rename
                  </Button>
                  {settings.hasPassword || settings.items.length > 1 ? (
                    <Button
                      type="button"
                      variant="dangerOutline"
                      size="compact"
                      disabled={saving}
                      onClick={() => settings.remove(passkey.id, name)}
                    >
                      <IconTrash className="size-4" aria-hidden="true" />
                      Delete
                    </Button>
                  ) : null}
                </div>
              }
            />
          );
        })}
        <SettingsItem
          title="Add a passkey"
          description="Register this browser or a hardware security key."
          action={
            <Button
              type="button"
              variant="ghost"
              size="compact"
              aria-haspopup="dialog"
              aria-expanded={settings.addEditorOpen}
              onClick={settings.openAddEditor}
            >
              Add
            </Button>
          }
        />
      </SettingsSection>

      <SettingsDialog
        open={settings.addEditorOpen}
        title="Add a passkey"
        description="Register this browser or a hardware security key."
        initialFocusRef={addInputRef}
        closeDisabled={saving}
        onClose={settings.cancelAddEditor}
      >
        <DialogNotice notice={notice} />
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            settings.add();
          }}
        >
          <Field
            label="Passkey name"
            hint="Optional. For example, Work laptop."
          >
            <Input
              ref={addInputRef}
              value={settings.name}
              onChange={(event) => settings.setName(event.target.value)}
              autoComplete="off"
              disabled={saving}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={settings.cancelAddEditor}
            >
              Cancel
            </Button>
            <Button disabled={saving}>Add passkey</Button>
          </div>
        </form>
      </SettingsDialog>

      <SettingsDialog
        open={Boolean(passkeyBeingRenamed)}
        title="Rename passkey"
        description={
          passkeyBeingRenamed?.friendlyName || "Choose a name for this passkey."
        }
        initialFocusRef={renameInputRef}
        closeDisabled={saving}
        onClose={settings.cancelRename}
      >
        <DialogNotice notice={notice} />
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            settings.rename();
          }}
        >
          <Field label="Passkey name">
            <Input
              ref={renameInputRef}
              value={settings.editedName}
              onChange={(event) => settings.setEditedName(event.target.value)}
              disabled={saving}
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={settings.cancelRename}
            >
              Cancel
            </Button>
            <Button disabled={saving || !settings.editedName.trim()}>
              Save
            </Button>
          </div>
        </form>
      </SettingsDialog>
    </>
  );
}

function TrustedDevicesSection({
  saving,
  notice,
  settings,
}: {
  saving: boolean;
  notice: SecurityNotice | null;
  settings: TrustedDeviceSettings;
}) {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const deviceBeingRenamed = settings.items.find(
    (device) => device.id === settings.editingId,
  );
  return (
    <>
      <SettingsSection
        title="Trusted devices"
        description="Trusted devices may skip two-factor authentication. Trust expires after 30 days of inactivity."
      >
        {settings.items.length === 0 ? (
          <SettingsItem
            title="No trusted devices"
            description="Devices you trust during sign-in will appear here."
          />
        ) : (
          settings.items.map((device) => {
            const name = device.friendlyName || "Unnamed device";
            return (
              <SettingsItem
                key={device.id}
                title={name}
                technical
                description={`Last seen ${formatDateTime(device.lastSeenAt)}`}
                action={
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      aria-haspopup="dialog"
                      aria-expanded={settings.editingId === device.id}
                      onClick={() => settings.startRename(device.id, name)}
                    >
                      <IconEdit className="size-4" aria-hidden="true" /> Rename
                    </Button>
                    <Button
                      type="button"
                      variant="dangerOutline"
                      size="compact"
                      disabled={saving}
                      onClick={() => settings.revoke(device)}
                    >
                      Revoke
                    </Button>
                  </div>
                }
              />
            );
          })
        )}
      </SettingsSection>
      <SettingsDialog
        open={Boolean(deviceBeingRenamed)}
        title="Rename trusted device"
        description={
          deviceBeingRenamed?.friendlyName || "Choose a name for this device."
        }
        initialFocusRef={renameInputRef}
        closeDisabled={saving}
        onClose={settings.cancelRename}
      >
        <DialogNotice notice={notice} />
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            settings.rename();
          }}
        >
          <Field label="Device name">
            <Input
              ref={renameInputRef}
              value={settings.editedName}
              onChange={(event) => settings.setEditedName(event.target.value)}
              disabled={saving}
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={settings.cancelRename}
            >
              Cancel
            </Button>
            <Button disabled={saving || !settings.editedName.trim()}>
              Save
            </Button>
          </div>
        </form>
      </SettingsDialog>
    </>
  );
}

function LinkedAccountsSection({
  saving,
  settings,
}: {
  saving: boolean;
  settings: LinkedAccountSettings;
}) {
  const availableProviders = settings.providers.filter(
    (provider) =>
      !settings.items.some((account) => account.provider === provider.provider),
  );
  if (settings.items.length === 0 && availableProviders.length === 0)
    return null;

  return (
    <SettingsSection
      title="Linked sign-in accounts"
      description="Use an external identity provider to sign in to this account."
    >
      {settings.items.map((account) => (
        <SettingsItem
          key={account.id}
          title={account.provider_name}
          description={
            account.provider_username ||
            account.provider_email ||
            "Linked account"
          }
          action={
            <Button
              type="button"
              variant="dangerOutline"
              size="compact"
              disabled={saving}
              onClick={() => settings.unlink(account)}
            >
              Unlink
            </Button>
          }
        />
      ))}
      {availableProviders.map((provider) => (
        <SettingsItem
          key={provider.provider}
          title={provider.name}
          description="Not linked"
          action={
            <Button
              type="button"
              variant="ghost"
              size="compact"
              disabled={settings.linkingProvider !== null}
              onClick={() => settings.link(provider)}
            >
              {settings.linkingProvider === provider.provider
                ? "Linking..."
                : "Link"}
            </Button>
          }
        />
      ))}
    </SettingsSection>
  );
}

export function SecuritySections({
  saving,
  notice,
  password,
  authenticator,
  passkeys,
  trustedDevices,
  linkedAccounts,
}: SecuritySectionsProps) {
  return (
    <>
      <SettingsSection
        title="Sign-in methods"
        description="Keep at least one way to sign in to your account."
      >
        <PasswordSettingsRow
          saving={saving}
          notice={notice}
          settings={password}
        />
        <AuthenticatorSettingsRow
          saving={saving}
          notice={notice}
          settings={authenticator}
        />
      </SettingsSection>
      <PasskeySection saving={saving} notice={notice} settings={passkeys} />
      <TrustedDevicesSection
        saving={saving}
        notice={notice}
        settings={trustedDevices}
      />
      <LinkedAccountsSection saving={saving} settings={linkedAccounts} />
    </>
  );
}
