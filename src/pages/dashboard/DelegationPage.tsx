import { useCallback, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  DashboardPage,
  Field,
  Input,
  Select,
  SettingsDialog,
  SettingsItem,
  SettingsSection,
  SettingsTag,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api, ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/date.ts";
import { useTranslation } from "../../lib/i18n.ts";
import {
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsScopeSet,
} from "../../lib/types/branded.ts";
import type {
  DelegationController,
  DelegationScopePreset,
} from "../../lib/types/api.ts";

type Notice = { tone: "success" | "error"; text: string };
type DialogName = "add-controller" | "create-account" | null;
type BusyAction = "resolve" | "add" | "create" | "remove" | null;

export type DelegationPageApi = Pick<
  typeof api,
  | "addDelegationController"
  | "createDelegatedAccount"
  | "getDelegationAuditLog"
  | "getDelegationScopePresets"
  | "listDelegationControlledAccounts"
  | "listDelegationControllers"
  | "removeDelegationController"
  | "resolveController"
>;

interface DelegationPageProps {
  apiClient?: DelegationPageApi;
}

function requestError(caught: unknown, fallback: string) {
  return caught instanceof ApiError || caught instanceof Error
    ? caught.message
    : fallback;
}

export function DelegationPage({ apiClient = api }: DelegationPageProps = {}) {
  const session = useSession();
  const t = useTranslation();
  const identifierInput = useRef<HTMLInputElement>(null);
  const handleInput = useRef<HTMLInputElement>(null);
  const loadDelegation = useCallback(async () => {
    const [controllers, accounts, presets, audit] = await Promise.all([
      apiClient.listDelegationControllers(session.accessJwt),
      apiClient.listDelegationControlledAccounts(session.accessJwt),
      apiClient.getDelegationScopePresets(),
      apiClient.getDelegationAuditLog(session.accessJwt, 20, 0),
    ]);
    if (!controllers.ok) throw controllers.error;
    if (!accounts.ok) throw accounts.error;
    if (!presets.ok) throw presets.error;
    if (!audit.ok) throw audit.error;
    return {
      controllers: controllers.value.controllers,
      accounts: accounts.value.accounts,
      presets: presets.value.presets,
      audit: audit.value,
    };
  }, [apiClient, session.accessJwt]);
  const resource = useAsync(loadDelegation);
  const [openDialog, setOpenDialog] = useState<DialogName>(null);
  const [pendingRemoval, setPendingRemoval] =
    useState<DelegationController | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [resolved, setResolved] = useState<{
    did: string;
    handle?: string;
    isLocal: boolean;
  } | null>(null);
  const [scope, setScope] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [createScope, setCreateScope] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const fallbackScope =
    resource.data?.presets.find((preset) => preset.name === "owner")?.scopes ??
    resource.data?.presets[0]?.scopes ??
    "";
  const selectedScope = scope || fallbackScope;
  const selectedCreateScope = createScope || fallbackScope;
  const hasControllers = Boolean(resource.data?.controllers.length);
  const controlsAccounts = Boolean(resource.data?.accounts.length);
  const dialogBusy = busyAction !== null;

  function scopeLabel(grantedScopes: string, presets: DelegationScopePreset[]) {
    const preset = presets.find(
      (candidate) => candidate.scopes === grantedScopes,
    );
    const name = preset?.name ?? grantedScopes ?? "viewer";
    switch (name.toLowerCase()) {
      case "owner":
        return t("delegation.scopeOwner");
      case "viewer":
        return t("delegation.scopeViewer");
      case "custom":
        return t("delegation.scopeCustom");
      default:
        return name;
    }
  }

  function auditActionLabel(action: string) {
    const normalized = action.toLowerCase().replace(/[\s_-]+/g, ".");
    switch (normalized) {
      case "grant.created":
        return t("delegation.actionGrantCreated");
      case "grant.revoked":
        return t("delegation.actionGrantRevoked");
      case "scopes.modified":
        return t("delegation.actionScopesModified");
      case "token.issued":
        return t("delegation.actionTokenIssued");
      case "repo.write":
        return t("delegation.actionRepoWrite");
      case "blob.upload":
        return t("delegation.actionBlobUpload");
      case "account.action":
        return t("delegation.actionAccountAction");
      default:
        return action;
    }
  }

  function openAddControllerDialog() {
    setNotice(null);
    setDialogError(null);
    setIdentifier("");
    setResolved(null);
    setScope("");
    setAcknowledged(false);
    setOpenDialog("add-controller");
  }

  function openCreateAccountDialog() {
    setNotice(null);
    setDialogError(null);
    setHandle("");
    setEmail("");
    setCreateScope("");
    setOpenDialog("create-account");
  }

  function closeDialog() {
    if (dialogBusy) return;
    setOpenDialog(null);
    setPendingRemoval(null);
    setDialogError(null);
  }

  async function resolveController() {
    setBusyAction("resolve");
    setDialogError(null);
    setResolved(null);
    setAcknowledged(false);
    try {
      const result = await apiClient.resolveController(
        identifier.trim().replace(/^@/, ""),
      );
      if (!result.ok) throw result.error;
      setResolved(result.value);
    } catch (caught) {
      setDialogError(requestError(caught, t("delegation.resolveFailed")));
    } finally {
      setBusyAction(null);
    }
  }

  async function addController(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolved || !acknowledged) return;
    setBusyAction("add");
    setDialogError(null);
    try {
      const result = await apiClient.addDelegationController(
        session.accessJwt,
        unsafeAsDid(resolved.did),
        unsafeAsScopeSet(selectedScope),
      );
      if (!result.ok) throw result.error;
      await resource.reload();
      setOpenDialog(null);
      setNotice({
        tone: "success",
        text: t("delegation.controllerAdded"),
      });
    } catch (caught) {
      setDialogError(requestError(caught, t("delegation.addFailed")));
    } finally {
      setBusyAction(null);
    }
  }

  async function createManagedAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedHandle = handle.trim();
    if (!trimmedHandle) return;
    setBusyAction("create");
    setDialogError(null);
    try {
      const result = await apiClient.createDelegatedAccount(
        session.accessJwt,
        unsafeAsHandle(trimmedHandle),
        email.trim() ? unsafeAsEmail(email.trim()) : undefined,
        unsafeAsScopeSet(selectedCreateScope),
      );
      if (!result.ok) throw result.error;
      await resource.reload();
      setOpenDialog(null);
      setNotice({
        tone: "success",
        text: t("delegation.accountCreated", { handle: trimmedHandle }),
      });
    } catch (caught) {
      setDialogError(requestError(caught, t("delegation.createFailed")));
    } finally {
      setBusyAction(null);
    }
  }

  async function removeController() {
    if (!pendingRemoval) return;
    setBusyAction("remove");
    setDialogError(null);
    try {
      const result = await apiClient.removeDelegationController(
        session.accessJwt,
        pendingRemoval.did,
      );
      if (!result.ok) throw result.error;
      await resource.reload();
      setPendingRemoval(null);
      setNotice({
        tone: "success",
        text: t("delegation.controllerRemoved"),
      });
    } catch (caught) {
      setDialogError(requestError(caught, t("delegation.removeFailed")));
    } finally {
      setBusyAction(null);
    }
  }

  const pageActions = resource.data ? (
    <>
      {!controlsAccounts ? (
        <Button
          type="button"
          variant={hasControllers ? "primary" : "secondary"}
          aria-haspopup="dialog"
          aria-expanded={openDialog === "add-controller"}
          onClick={openAddControllerDialog}
        >
          {t("delegation.addController")}
        </Button>
      ) : null}
      {!hasControllers ? (
        <Button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={openDialog === "create-account"}
          onClick={openCreateAccountDialog}
        >
          {t("delegation.createAccount")}
        </Button>
      ) : null}
    </>
  ) : undefined;

  if (resource.loading && !resource.data) {
    return (
      <DashboardPage
        title={t("dashboard.navDelegation")}
        description={t("delegation.description")}
        actions={pageActions}
        busy
      >
        <SettingsSection title={t("delegation.accessToAccount")}>
          <SettingsItem title={t("common.loading")} />
        </SettingsSection>
        <SettingsSection title={t("delegation.accountsYouManage")}>
          <SettingsItem title={t("common.loading")} />
        </SettingsSection>
      </DashboardPage>
    );
  }

  if (!resource.data) {
    return (
      <DashboardPage
        title={t("dashboard.navDelegation")}
        description={t("delegation.description")}
        actions={pageActions}
      >
        <Alert tone="error">
          {resource.error ?? t("delegation.loadFailed")}
        </Alert>
      </DashboardPage>
    );
  }

  const { controllers, accounts, presets, audit } = resource.data;

  return (
    <DashboardPage
      title={t("dashboard.navDelegation")}
      description={t("delegation.description")}
      actions={pageActions}
    >
      {resource.error ? <Alert tone="error">{resource.error}</Alert> : null}
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <SettingsSection title={t("delegation.accessToAccount")}>
        {controlsAccounts ? (
          <SettingsItem
            title={t("delegation.controllerAccessUnavailable")}
            description={t("delegation.cannotAddControllers")}
          />
        ) : controllers.length === 0 ? (
          <SettingsItem title={t("delegation.noControllersDescription")} />
        ) : (
          controllers.map((controller) => (
            <SettingsItem
              key={controller.did}
              technical
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    {controller.handle
                      ? `@${controller.handle}`
                      : controller.did}
                  </span>
                  <SettingsTag>
                    {scopeLabel(controller.grantedScopes, presets)}
                  </SettingsTag>
                  {!controller.isActive ? (
                    <SettingsTag>{t("delegation.inactive")}</SettingsTag>
                  ) : null}
                </span>
              }
              description={
                <span className="grid gap-1">
                  {controller.handle ? (
                    <span className="font-mono break-all">
                      {controller.did}
                    </span>
                  ) : null}
                  <span>
                    {t("delegation.grantedOn", {
                      date: formatDateTime(controller.grantedAt),
                    })}
                  </span>
                </span>
              }
              action={
                <Button
                  type="button"
                  variant="dangerOutline"
                  size="compact"
                  disabled={dialogBusy}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setNotice(null);
                    setDialogError(null);
                    setPendingRemoval(controller);
                  }}
                >
                  {t("delegation.remove")}
                </Button>
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={t("delegation.accountsYouManage")}>
        {hasControllers ? (
          <SettingsItem
            title={t("delegation.managedAccountsUnavailable")}
            description={t("delegation.cannotControlAccounts")}
          />
        ) : accounts.length === 0 ? (
          <SettingsItem title={t("delegation.noControlledAccounts")} />
        ) : (
          accounts.map((account) => (
            <SettingsItem
              key={account.did}
              technical
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    {account.handle ? `@${account.handle}` : account.did}
                  </span>
                  <SettingsTag>
                    {scopeLabel(account.grantedScopes, presets)}
                  </SettingsTag>
                </span>
              }
              description={
                account.handle ? (
                  <span className="font-mono break-all">{account.did}</span>
                ) : undefined
              }
              action={
                <Link
                  className={buttonClasses(
                    "secondary",
                    "no-underline",
                    "compact",
                  )}
                  to={`/app/act-as?did=${encodeURIComponent(account.did)}`}
                >
                  {t("delegation.openAccount")}
                </Link>
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={t("delegation.recentActivity")}>
        {audit.entries.length === 0 ? (
          <SettingsItem title={t("delegation.noAuditEntries")} />
        ) : (
          audit.entries.map((entry) => (
            <SettingsItem
              key={entry.id}
              title={auditActionLabel(entry.action)}
              description={
                <span className="grid gap-1">
                  <span className="font-mono break-all">
                    {t("delegation.actor")}: {entry.actor_did}
                  </span>
                  {entry.target_did ? (
                    <span className="font-mono break-all">
                      {t("delegation.target")}: {entry.target_did}
                    </span>
                  ) : null}
                  {entry.details ? <span>{entry.details}</span> : null}
                </span>
              }
              action={
                <time className="text-xs whitespace-nowrap text-ctp-overlay1">
                  {formatDateTime(entry.created_at)}
                </time>
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsDialog
        open={openDialog === "add-controller"}
        title={t("delegation.addController")}
        description={t("delegation.addControllerDescription")}
        initialFocusRef={identifierInput}
        closeDisabled={dialogBusy}
        onClose={closeDialog}
      >
        {dialogError ? (
          <div className="mb-4">
            <Alert tone="error">{dialogError}</Alert>
          </div>
        ) : null}
        <form className="grid gap-4" onSubmit={addController}>
          <Field label={t("delegation.controllerIdentifier")}>
            <div className="grid gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                ref={identifierInput}
                value={identifier}
                placeholder={t("delegation.controllerIdentifierPlaceholder")}
                disabled={dialogBusy}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setResolved(null);
                  setAcknowledged(false);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={dialogBusy || !identifier.trim()}
                onClick={() => void resolveController()}
              >
                {busyAction === "resolve"
                  ? t("delegation.finding")
                  : t("delegation.find")}
              </Button>
            </div>
          </Field>

          {resolved ? (
            <>
              <Card className="divide-y divide-ctp-surface0">
                <div className="flex min-w-0 items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm break-words text-ctp-text">
                      {resolved.handle ? `@${resolved.handle}` : resolved.did}
                    </p>
                    {resolved.handle ? (
                      <p className="mt-1 font-mono text-xs break-all text-ctp-overlay1">
                        {resolved.did}
                      </p>
                    ) : null}
                  </div>
                  <SettingsTag>
                    {resolved.isLocal
                      ? t("delegation.local")
                      : t("delegation.remote")}
                  </SettingsTag>
                </div>
              </Card>
              <Field label={t("delegation.accessLevel")}>
                <Select
                  value={selectedScope}
                  disabled={dialogBusy}
                  onChange={(event) => setScope(event.target.value)}
                >
                  {presets.map((preset) => (
                    <option key={preset.name} value={preset.scopes}>
                      {scopeLabel(preset.scopes, presets)} -{" "}
                      {preset.description}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="rounded border border-ctp-yellow/40 bg-ctp-yellow/10 p-4 text-sm text-ctp-subtext1">
                <p className="font-mono font-semibold text-ctp-yellow">
                  {t("delegation.addControllerWarningTitle")}
                </p>
                <p className="mt-2 leading-6">
                  {t("delegation.addControllerWarningText")}
                </p>
                <ul className="mt-2 grid list-disc gap-1 pl-5 text-xs leading-5">
                  <li>{t("delegation.addControllerWarningBullet1")}</li>
                  <li>{t("delegation.addControllerWarningBullet2")}</li>
                  <li>{t("delegation.addControllerWarningBullet3")}</li>
                </ul>
              </div>
              <label className="flex items-start gap-3 text-sm leading-6 text-ctp-text">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-ctp-lavender"
                  checked={acknowledged}
                  disabled={dialogBusy}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>{t("delegation.addControllerConfirm")}</span>
              </label>
            </>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={dialogBusy}
              onClick={closeDialog}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={dialogBusy || !resolved || !acknowledged}>
              {busyAction === "add"
                ? t("delegation.adding")
                : t("delegation.addController")}
            </Button>
          </div>
        </form>
      </SettingsDialog>

      <SettingsDialog
        open={openDialog === "create-account"}
        title={t("delegation.createDelegatedAccount")}
        description={t("delegation.createAccountDescription")}
        initialFocusRef={handleInput}
        closeDisabled={dialogBusy}
        onClose={closeDialog}
      >
        {dialogError ? (
          <div className="mb-4">
            <Alert tone="error">{dialogError}</Alert>
          </div>
        ) : null}
        <form className="grid gap-4" onSubmit={createManagedAccount}>
          <Field label={t("delegation.handle")}>
            <Input
              ref={handleInput}
              value={handle}
              placeholder="name.example.com"
              autoComplete="off"
              disabled={dialogBusy}
              required
              onChange={(event) => setHandle(event.target.value)}
            />
          </Field>
          <Field label={t("delegation.emailOptional")}>
            <Input
              type="email"
              value={email}
              autoComplete="email"
              disabled={dialogBusy}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label={t("delegation.yourAccessLevel")}>
            <Select
              value={selectedCreateScope}
              disabled={dialogBusy}
              onChange={(event) => setCreateScope(event.target.value)}
            >
              {presets.map((preset) => (
                <option key={preset.name} value={preset.scopes}>
                  {scopeLabel(preset.scopes, presets)} - {preset.description}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={dialogBusy}
              onClick={closeDialog}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={dialogBusy || !handle.trim()}>
              {busyAction === "create"
                ? t("common.creating")
                : t("delegation.createAccount")}
            </Button>
          </div>
        </form>
      </SettingsDialog>

      <SettingsDialog
        open={Boolean(pendingRemoval)}
        title={t("delegation.removeController")}
        description={t("delegation.removeConfirm")}
        maxWidth="sm"
        closeDisabled={dialogBusy}
        onClose={closeDialog}
      >
        {dialogError ? (
          <div className="mb-4">
            <Alert tone="error">{dialogError}</Alert>
          </div>
        ) : null}
        {pendingRemoval ? (
          <p className="mb-5 font-mono text-sm break-all text-ctp-text">
            {pendingRemoval.handle
              ? `@${pendingRemoval.handle}`
              : pendingRemoval.did}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={dialogBusy}
            onClick={closeDialog}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={dialogBusy}
            onClick={() => void removeController()}
          >
            {busyAction === "remove"
              ? t("delegation.removing")
              : t("delegation.remove")}
          </Button>
        </div>
      </SettingsDialog>
    </DashboardPage>
  );
}
