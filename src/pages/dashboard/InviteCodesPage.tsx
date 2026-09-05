import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import {
  Alert,
  Button,
  PageHeading,
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
import type { InviteCodeInfo } from "../../lib/types/api.ts";

export type InviteCodesPageApi = Pick<
  typeof api,
  "getAccountInviteCodes" | "createInviteCode" | "disableInviteCodes"
>;

interface InviteCodesPageProps {
  apiClient?: InviteCodesPageApi;
  confirmAction?: (message: string) => boolean;
}

function inviteStatus(
  code: InviteCodeInfo,
): "available" | "used" | "spent" | "disabled" {
  if (code.disabled) return "disabled";
  if (code.uses.length > 0) return "used";
  return code.available === 0 ? "spent" : "available";
}

function invitee(code: InviteCodeInfo) {
  const use = code.uses[0];
  if (!use) return null;
  return use.usedByHandle || use.usedBy.split(":").at(-1) || use.usedBy;
}

export function InviteCodesPage({
  apiClient = api,
  confirmAction,
}: InviteCodesPageProps = {}) {
  const session = useSession();
  const t = useTranslation();
  const loadInviteCodes = useCallback(
    () => apiClient.getAccountInviteCodes(session.accessJwt),
    [apiClient, session.accessJwt],
  );
  const resource = useAsync(loadInviteCodes);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [pendingDisable, setPendingDisable] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [disablingCode, setDisablingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copyFeedbackTimeout.current), []);

  function statusLabel(status: ReturnType<typeof inviteStatus>) {
    switch (status) {
      case "available":
        return t("inviteCodes.available");
      case "used":
        return t("inviteCodes.usedStatus");
      case "spent":
        return t("inviteCodes.spent");
      case "disabled":
        return t("inviteCodes.disabled");
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      clearTimeout(copyFeedbackTimeout.current);
      copyFeedbackTimeout.current = setTimeout(
        () => setCopiedCode((current) => (current === code ? null : current)),
        2000,
      );
    } catch {
      setError(t("about.copyFailed"));
    }
  }

  async function createCode() {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.createInviteCode(session.accessJwt, 1);
      setCreatedCode(result.code);
      await resource.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : t("inviteCodes.createFailed"),
      );
    } finally {
      setCreating(false);
    }
  }

  function requestDisable(code: string) {
    const confirmation = t("inviteCodes.disableConfirm", { code });
    if (confirmAction) {
      if (confirmAction(confirmation)) void disableCode(code);
      return;
    }
    setError(null);
    setNotice(null);
    setPendingDisable(code);
  }

  function closeDisableDialog() {
    if (disablingCode) return;
    setPendingDisable(null);
    setError(null);
  }

  async function disableCode(code: string) {
    setDisablingCode(code);
    setError(null);
    setNotice(null);
    try {
      await apiClient.disableInviteCodes(session.accessJwt, [code]);
      resource.setData((current) =>
        current
          ? {
              ...current,
              codes: current.codes.map((item) =>
                item.code === code ? { ...item, disabled: true } : item,
              ),
            }
          : current,
      );
      setPendingDisable(null);
      setNotice(t("inviteCodes.disableSuccess"));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : t("inviteCodes.disableFailed"),
      );
    } finally {
      setDisablingCode(null);
    }
  }

  const heading = (
    <PageHeading
      title={t("dashboard.navInviteCodes")}
      description={t("inviteCodes.description")}
      actions={
        session.isAdmin ? (
          <Button
            aria-haspopup="dialog"
            disabled={creating}
            onClick={() => void createCode()}
          >
            {creating ? t("common.creating") : t("inviteCodes.createNew")}
          </Button>
        ) : undefined
      }
    />
  );

  if (resource.loading && !resource.data) {
    return (
      <div className="mx-auto grid w-full max-w-[52rem] gap-6" aria-busy="true">
        {heading}
        <SettingsSection title={t("dashboard.navInviteCodes")} titleHidden>
          <SettingsItem title={t("common.loading")} />
          <SettingsItem title={t("common.loading")} />
        </SettingsSection>
      </div>
    );
  }

  if (!resource.data) {
    return (
      <div className="mx-auto grid w-full max-w-[52rem] gap-6">
        {heading}
        <Alert tone="error">
          {resource.error ?? t("inviteCodes.loadFailed")}
        </Alert>
      </div>
    );
  }

  const dialogOpen = Boolean(createdCode || pendingDisable);

  return (
    <div className="mx-auto grid w-full max-w-[52rem] gap-6">
      {heading}
      {resource.error ? <Alert tone="error">{resource.error}</Alert> : null}
      {error && !dialogOpen ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <SettingsSection title={t("dashboard.navInviteCodes")} titleHidden>
        {resource.data.codes.map((code) => {
          const status = inviteStatus(code);
          const usedBy = invitee(code);
          return (
            <SettingsItem
              key={code.code}
              technical
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <code
                    className={
                      status === "disabled"
                        ? "text-ctp-overlay1 line-through"
                        : undefined
                    }
                  >
                    {code.code}
                  </code>
                  <SettingsTag
                    tone={status === "available" ? "accent" : "neutral"}
                  >
                    {statusLabel(status)}
                  </SettingsTag>
                </span>
              }
              description={
                <span className="flex flex-wrap gap-x-2">
                  <span>
                    {t("inviteCodes.createdOn", {
                      date: formatDate(code.createdAt),
                    })}
                  </span>
                  {usedBy ? (
                    <span>{t("inviteCodes.used", { handle: usedBy })}</span>
                  ) : null}
                </span>
              }
              action={
                <div className="flex flex-wrap gap-1 min-[360px]:justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    onClick={() => void copy(code.code)}
                  >
                    {copiedCode === code.code ? (
                      <IconCheck className="size-4" aria-hidden="true" />
                    ) : (
                      <IconCopy className="size-4" aria-hidden="true" />
                    )}
                    {copiedCode === code.code
                      ? t("common.copied")
                      : t("inviteCodes.copy")}
                  </Button>
                  {status === "available" ? (
                    <Button
                      type="button"
                      variant="dangerOutline"
                      size="compact"
                      disabled={Boolean(disablingCode)}
                      aria-haspopup="dialog"
                      onClick={() => requestDisable(code.code)}
                    >
                      {t("inviteCodes.disable")}
                    </Button>
                  ) : null}
                </div>
              }
            />
          );
        })}
        {resource.data.codes.length === 0 ? (
          <SettingsItem title={t("inviteCodes.noCodes")} />
        ) : null}
      </SettingsSection>

      <span className="sr-only" aria-live="polite">
        {copiedCode ? t("common.copied") : ""}
      </span>

      <SettingsDialog
        open={Boolean(createdCode)}
        title={t("inviteCodes.created")}
        description={t("inviteCodes.createdDescription")}
        maxWidth="sm"
        closeDisabled={creating}
        onClose={() => setCreatedCode(null)}
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        <div className="grid gap-2">
          <code className="rounded border border-ctp-surface1 bg-ctp-crust px-3 py-3 font-mono text-sm break-all text-ctp-text">
            {createdCode}
          </code>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (createdCode) void copy(createdCode);
            }}
          >
            {copiedCode === createdCode ? (
              <IconCheck className="size-4" aria-hidden="true" />
            ) : (
              <IconCopy className="size-4" aria-hidden="true" />
            )}
            {copiedCode === createdCode
              ? t("common.copied")
              : t("common.copyToClipboard")}
          </Button>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={() => setCreatedCode(null)}>
            {t("common.done")}
          </Button>
        </div>
      </SettingsDialog>

      <SettingsDialog
        open={Boolean(pendingDisable)}
        title={t("inviteCodes.disable")}
        description={
          pendingDisable
            ? t("inviteCodes.disableConfirm", { code: pendingDisable })
            : undefined
        }
        maxWidth="sm"
        closeDisabled={Boolean(disablingCode)}
        onClose={closeDisableDialog}
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
            disabled={Boolean(disablingCode)}
            onClick={closeDisableDialog}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="dangerOutline"
            disabled={Boolean(disablingCode)}
            onClick={() => {
              if (pendingDisable) void disableCode(pendingDisable);
            }}
          >
            {t("inviteCodes.disable")}
          </Button>
        </div>
      </SettingsDialog>
    </div>
  );
}
