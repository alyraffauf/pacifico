import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import {
  Alert,
  Button,
  Field,
  Input,
  PageHeading,
  Select,
  SettingsDialog,
  SettingsItem,
  SettingsSection,
  SettingsTag,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api, ApiError } from "../../lib/api.ts";
import { formatDate } from "../../lib/date.ts";
import { useTranslation } from "../../lib/i18n.ts";
import type { AppPassword } from "../../lib/types/api.ts";

const scopePresets = {
  full: undefined,
  readonly:
    "rpc:app.bsky.*?aud=* rpc:chat.bsky.*?aud=* account:status?action=read",
  posting: "repo:app.bsky.feed.post?action=create blob:*/*",
};

type ScopePreset = keyof typeof scopePresets;

function passwordScope(password: AppPassword): ScopePreset | "custom" {
  if (!password.scopes) return "full";
  if (password.scopes === scopePresets.readonly) return "readonly";
  if (password.scopes === scopePresets.posting) return "posting";
  return "custom";
}

export function AppPasswordsPage() {
  const session = useSession();
  const t = useTranslation();
  const loadPasswords = useCallback(
    () => api.listAppPasswords(session.accessJwt),
    [session.accessJwt],
  );
  const passwords = useAsync(loadPasswords);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ScopePreset>("full");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [pendingRevocation, setPendingRevocation] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copyFeedbackTimeout.current), []);

  function scopeLabel(passwordScopeValue: ScopePreset | "custom") {
    switch (passwordScopeValue) {
      case "full":
        return t("appPasswords.scopeFull");
      case "readonly":
        return t("appPasswords.scopeReadOnly");
      case "posting":
        return t("appPasswords.scopePostOnly");
      case "custom":
        return t("appPasswords.scopeCustom");
    }
  }

  function openCreateDialog() {
    setPendingRevocation(null);
    setError(null);
    setNotice(null);
    setCreateDialogOpen(true);
  }

  function closeCreateDialog() {
    if (creating) return;
    setCreateDialogOpen(false);
    setName("");
    setScope("full");
    setError(null);
  }

  async function createPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.createAppPassword(
        session.accessJwt,
        name.trim(),
        scopePresets[scope],
      );
      setCreatedPassword(result.password);
      setAcknowledged(false);
      setPasswordCopied(false);
      setCreateDialogOpen(false);
      setName("");
      setScope("full");
      await passwords.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : t("appPasswords.createFailed"),
      );
    } finally {
      setCreating(false);
    }
  }

  function requestPasswordRevocation(passwordName: string) {
    setCreateDialogOpen(false);
    setError(null);
    setNotice(null);
    setPendingRevocation(passwordName);
  }

  function closeRevocationDialog() {
    if (revoking) return;
    setPendingRevocation(null);
    setError(null);
  }

  async function revokePassword(passwordName: string) {
    setRevoking(passwordName);
    setError(null);
    setNotice(null);
    try {
      await api.revokeAppPassword(session.accessJwt, passwordName);
      await passwords.reload();
      setPendingRevocation(null);
      setNotice(t("appPasswords.deleted"));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : t("appPasswords.deleteFailed"),
      );
    } finally {
      setRevoking(null);
    }
  }

  async function copyCreatedPassword() {
    if (!createdPassword) return;
    try {
      await navigator.clipboard.writeText(createdPassword);
      setPasswordCopied(true);
      clearTimeout(copyFeedbackTimeout.current);
      copyFeedbackTimeout.current = setTimeout(
        () => setPasswordCopied(false),
        2000,
      );
    } catch {
      setPasswordCopied(false);
    }
  }

  function closeCreatedPassword() {
    if (!acknowledged) return;
    setCreatedPassword(null);
    setAcknowledged(false);
    setPasswordCopied(false);
  }

  const heading = (
    <PageHeading
      title={t("dashboard.navAppPasswords")}
      description={t("appPasswords.description")}
      actions={
        <Button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={createDialogOpen}
          disabled={creating}
          onClick={openCreateDialog}
        >
          {t("appPasswords.createPassword")}
        </Button>
      }
    />
  );

  if (passwords.loading && !passwords.data) {
    return (
      <div className="mx-auto grid w-full max-w-[52rem] gap-6" aria-busy="true">
        {heading}
        <SettingsSection title={t("dashboard.navAppPasswords")} titleHidden>
          <SettingsItem title={t("common.loading")} />
          <SettingsItem title={t("common.loading")} />
        </SettingsSection>
      </div>
    );
  }

  if (!passwords.data) {
    return (
      <div className="mx-auto grid w-full max-w-[52rem] gap-6">
        {heading}
        <Alert tone="error">
          {passwords.error ?? t("appPasswords.loadFailed")}
        </Alert>
      </div>
    );
  }

  const dialogOpen = Boolean(
    createDialogOpen || createdPassword || pendingRevocation,
  );

  return (
    <div className="mx-auto grid w-full max-w-[52rem] gap-6">
      {heading}
      {passwords.error ? <Alert tone="error">{passwords.error}</Alert> : null}
      {error && !dialogOpen ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <SettingsSection title={t("dashboard.navAppPasswords")} titleHidden>
        {passwords.data.passwords.map((password) => (
          <SettingsItem
            key={password.name}
            technical
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span>{password.name}</span>
                <SettingsTag>{scopeLabel(passwordScope(password))}</SettingsTag>
                {password.createdByController ? (
                  <SettingsTag>{t("appPasswords.byController")}</SettingsTag>
                ) : null}
              </span>
            }
            description={
              <span className="grid gap-1">
                <span>
                  {t("appPasswords.createdOn", {
                    date: formatDate(password.createdAt),
                  })}
                </span>
                {password.createdByController ? (
                  <span className="font-mono break-all">
                    {password.createdByController}
                  </span>
                ) : null}
              </span>
            }
            action={
              <Button
                type="button"
                variant="dangerOutline"
                size="compact"
                disabled={Boolean(revoking)}
                aria-haspopup="dialog"
                onClick={() => requestPasswordRevocation(password.name)}
              >
                {t("common.revoke")}
              </Button>
            }
          />
        ))}
        {passwords.data.passwords.length === 0 ? (
          <SettingsItem title={t("appPasswords.noPasswords")} />
        ) : null}
      </SettingsSection>

      <SettingsDialog
        open={createDialogOpen}
        title={t("appPasswords.createPassword")}
        description={t("appPasswords.createDescription")}
        initialFocusRef={nameInputRef}
        closeDisabled={creating}
        onClose={closeCreateDialog}
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        <form className="grid gap-4" onSubmit={createPassword}>
          <Field label={t("appPasswords.name")}>
            <Input
              ref={nameInputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("appPasswords.namePlaceholder")}
              autoComplete="off"
              disabled={creating}
              required
            />
          </Field>
          <Field label={t("appPasswords.permissions")}>
            <Select
              value={scope}
              onChange={(event) => setScope(event.target.value as ScopePreset)}
              disabled={creating}
            >
              <option value="full">{t("appPasswords.scopeFull")}</option>
              <option value="readonly">
                {t("appPasswords.scopeReadOnly")}
              </option>
              <option value="posting">{t("appPasswords.scopePostOnly")}</option>
            </Select>
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={creating}
              onClick={closeCreateDialog}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={creating || !name.trim()}>
              {t("appPasswords.create")}
            </Button>
          </div>
        </form>
      </SettingsDialog>

      <SettingsDialog
        open={Boolean(createdPassword)}
        title={t("appPasswords.created")}
        description={t("appPasswords.createdMessage")}
        maxWidth="sm"
        closeDisabled={!acknowledged}
        onClose={closeCreatedPassword}
      >
        <Alert tone="warning">
          <p className="font-semibold">{t("appPasswords.saveWarningTitle")}</p>
          <p className="mt-1 text-xs leading-5">
            {t("appPasswords.saveWarningMessage")}
          </p>
        </Alert>
        <div className="mt-4 grid gap-2">
          <code className="rounded border border-ctp-surface1 bg-ctp-crust px-3 py-3 font-mono text-sm break-all text-ctp-text">
            {createdPassword}
          </code>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void copyCreatedPassword()}
          >
            {passwordCopied ? (
              <IconCheck className="size-4" aria-hidden="true" />
            ) : (
              <IconCopy className="size-4" aria-hidden="true" />
            )}
            {passwordCopied ? t("common.copied") : t("common.copyToClipboard")}
          </Button>
          <span className="sr-only" aria-live="polite">
            {passwordCopied ? t("common.copied") : ""}
          </span>
        </div>
        <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-ctp-subtext1">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {t("appPasswords.acknowledgeLabel")}
        </label>
        <div className="mt-5 flex justify-end">
          <Button disabled={!acknowledged} onClick={closeCreatedPassword}>
            {t("common.done")}
          </Button>
        </div>
      </SettingsDialog>

      <SettingsDialog
        open={Boolean(pendingRevocation)}
        title={t("appPasswords.revokePassword")}
        description={
          pendingRevocation
            ? t("appPasswords.deleteConfirm", { name: pendingRevocation })
            : undefined
        }
        maxWidth="sm"
        closeDisabled={Boolean(revoking)}
        onClose={closeRevocationDialog}
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={Boolean(revoking)}
            onClick={closeRevocationDialog}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="dangerOutline"
            disabled={Boolean(revoking)}
            onClick={() => {
              if (pendingRevocation) void revokePassword(pendingRevocation);
            }}
          >
            {t("common.revoke")}
          </Button>
        </div>
      </SettingsDialog>
    </div>
  );
}
