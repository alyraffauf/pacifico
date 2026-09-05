import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeading,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api, ApiError } from "../../lib/api.ts";
import { formatDate } from "../../lib/date.ts";
import { useTranslation } from "../../lib/i18n.ts";
import type { InviteCodeInfo } from "../../lib/types/api.ts";

function inviteStatus(
  code: InviteCodeInfo,
  t: ReturnType<typeof useTranslation>,
): string {
  if (code.disabled) return t("inviteCodes.disabled");
  if (code.uses.length > 0) {
    const use = code.uses[0];
    return t("inviteCodes.used", {
      handle: use.usedByHandle || use.usedBy.split(":").at(-1) || use.usedBy,
    });
  }
  return code.available === 0
    ? t("inviteCodes.spent")
    : t("inviteCodes.available");
}

export function InviteCodesPage() {
  const session = useSession();
  const t = useTranslation();
  const resource = useAsync(
    () => api.getAccountInviteCodes(session.accessJwt),
    [session.accessJwt],
  );
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [disablingCode, setDisablingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(
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
    try {
      const result = await api.createInviteCode(session.accessJwt, 1);
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

  async function disableCode(code: string) {
    if (!confirm(t("inviteCodes.disableConfirm", { code }))) return;
    setDisablingCode(code);
    setError(null);
    try {
      await api.disableInviteCodes(session.accessJwt, [code]);
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

  return (
    <div className="grid gap-6">
      <PageHeading
        title={t("dashboard.navInviteCodes")}
        description={t("inviteCodes.yourCodes")}
        actions={
          session.isAdmin ? (
            <Button disabled={creating} onClick={() => void createCode()}>
              {creating ? t("common.creating") : t("inviteCodes.createNew")}
            </Button>
          ) : undefined
        }
      />
      {createdCode ? (
        <Alert tone="warning">
          <p className="font-semibold">{t("inviteCodes.created")}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code className="flex-1 break-all rounded bg-ctp-crust px-3 py-2 font-mono text-ctp-text">
              {createdCode}
            </code>
            <Button variant="secondary" onClick={() => void copy(createdCode)}>
              {copiedCode === createdCode
                ? t("common.copied")
                : t("common.copyToClipboard")}
            </Button>
            <Button variant="ghost" onClick={() => setCreatedCode(null)}>
              {t("common.done")}
            </Button>
          </div>
        </Alert>
      ) : null}
      {error || resource.error ? (
        <Alert tone="error">{error ?? resource.error}</Alert>
      ) : null}
      {resource.loading ? (
        <Loading />
      ) : resource.data?.codes.length === 0 ? (
        <EmptyState>{t("inviteCodes.noCodes")}</EmptyState>
      ) : (
        <div className="grid gap-3">
          {resource.data?.codes.map((code) => (
            <Card
              key={code.code}
              className={code.disabled ? "p-4 opacity-70" : "p-4"}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <code
                    className={
                      code.disabled
                        ? "font-mono text-sm text-ctp-overlay-1 line-through"
                        : "font-mono text-sm text-ctp-green"
                    }
                  >
                    {code.code}
                  </code>
                  <p className="mt-1 text-xs text-ctp-overlay-1">
                    {t("inviteCodes.createdOn", {
                      date: formatDate(code.createdAt),
                    })}{" "}
                    · {inviteStatus(code, t)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void copy(code.code)}
                  >
                    {copiedCode === code.code
                      ? t("common.copied")
                      : t("inviteCodes.copy")}
                  </Button>
                  {!code.disabled && code.available > 0 ? (
                    <Button
                      variant="danger"
                      disabled={disablingCode === code.code}
                      onClick={() => void disableCode(code.code)}
                    >
                      {t("inviteCodes.disable")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
