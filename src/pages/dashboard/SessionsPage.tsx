import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { api } from "../../lib/api.ts";
import { logout } from "../../lib/auth.ts";
import { formatDateTime } from "../../lib/date.ts";
import { useTranslation } from "../../lib/i18n.ts";

export function SessionsPage() {
  const session = useSession();
  const t = useTranslation();
  const navigate = useNavigate();
  const loadSessions = useCallback(
    () => api.listSessions(session.accessJwt),
    [session.accessJwt],
  );
  const resource = useAsync(loadSessions);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  async function revoke(sessionId: string, isCurrent: boolean) {
    if (
      !window.confirm(
        t(
          isCurrent
            ? "sessions.revokeCurrentConfirm"
            : "sessions.revokeConfirm",
        ),
      )
    )
      return;
    setMutating(true);
    setMutationError(null);
    try {
      await api.revokeSession(session.accessJwt, sessionId);
      if (isCurrent) {
        await logout();
        navigate("/app/login", { replace: true });
      } else {
        await resource.reload();
      }
    } catch (caught) {
      setMutationError(
        caught instanceof Error
          ? caught.message
          : "Could not revoke the session.",
      );
    } finally {
      setMutating(false);
    }
  }

  async function revokeOthers() {
    const count =
      resource.data?.sessions.filter((item) => !item.isCurrent).length ?? 0;
    if (
      count === 0 ||
      !window.confirm(t("sessions.revokeAllConfirm", { count }))
    )
      return;
    setMutating(true);
    setMutationError(null);
    try {
      await api.revokeAllSessions(session.accessJwt);
      await resource.reload();
    } catch (caught) {
      setMutationError(
        caught instanceof Error
          ? caught.message
          : "Could not revoke the sessions.",
      );
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeading
        title={t("dashboard.navSessions")}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={mutating}
              onClick={() => void resource.reload()}
            >
              {t("common.refresh")}
            </Button>
            <Button
              variant="danger"
              disabled={
                mutating ||
                !resource.data?.sessions.some((item) => !item.isCurrent)
              }
              onClick={() => void revokeOthers()}
            >
              {t("sessions.revokeAll")}
            </Button>
          </>
        }
      />
      {resource.error ? <Alert tone="error">{resource.error}</Alert> : null}
      {mutationError ? <Alert tone="error">{mutationError}</Alert> : null}
      {resource.loading ? <Loading label={t("common.loading")} /> : null}
      {!resource.loading && resource.data?.sessions.length === 0 ? (
        <EmptyState>{t("sessions.noSessions")}</EmptyState>
      ) : null}
      <div className="grid gap-3">
        {resource.data?.sessions.map((item) => (
          <Card
            key={item.id}
            className={`flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between ${item.isCurrent ? "border-ctp-green/60" : ""}`}
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-mono text-sm font-semibold text-ctp-text">
                  {item.clientName ||
                    (item.sessionType === "oauth"
                      ? "OAuth client"
                      : "Account session")}
                </h2>
                {item.isCurrent ? (
                  <span className="rounded bg-ctp-green/15 px-2 py-0.5 text-xs font-semibold text-ctp-green">
                    {t("sessions.current")}
                  </span>
                ) : null}
                <span className="rounded bg-ctp-surface0 px-2 py-0.5 text-xs text-ctp-subtext0">
                  {item.sessionType}
                </span>
              </div>
              <p className="mt-2 text-xs text-ctp-overlay1">
                {t("sessions.created")} {formatDateTime(item.createdAt)} ·{" "}
                {t("sessions.expires")} {formatDateTime(item.expiresAt)}
              </p>
            </div>
            <Button
              variant={item.isCurrent ? "secondary" : "danger"}
              disabled={mutating}
              onClick={() => void revoke(item.id, item.isCurrent)}
            >
              {item.isCurrent ? t("sessions.signOut") : t("sessions.revoke")}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
