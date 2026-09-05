import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconRefresh } from "@tabler/icons-react";
import {
  Alert,
  Button,
  PageHeading,
  SettingsDialog,
  SettingsItem,
  SettingsRow,
  SettingsSection,
  SettingsTag,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api } from "../../lib/api.ts";
import { logout } from "../../lib/auth.ts";
import { formatDateTime } from "../../lib/date.ts";
import { useTranslation } from "../../lib/i18n.ts";
import type { SessionInfo } from "../../lib/types/api.ts";

type PendingRevocation =
  { kind: "session"; session: SessionInfo } | { kind: "others"; count: number };

function sessionName(session: SessionInfo) {
  if (session.clientName) return session.clientName;
  return session.sessionType === "oauth" ? "OAuth client" : "Account session";
}

function sessionTypeLabel(session: SessionInfo) {
  return session.sessionType.replaceAll("_", " ");
}

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
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [pendingRevocation, setPendingRevocation] =
    useState<PendingRevocation | null>(null);

  function requestSessionRevocation(sessionToRevoke: SessionInfo) {
    setMutationError(null);
    setMutationNotice(null);
    setPendingRevocation({ kind: "session", session: sessionToRevoke });
  }

  function requestOtherSessionRevocation() {
    const count =
      resource.data?.sessions.filter((item) => !item.isCurrent).length ?? 0;
    if (count === 0) return;
    setMutationError(null);
    setMutationNotice(null);
    setPendingRevocation({ kind: "others", count });
  }

  function closeRevocationDialog() {
    if (mutating) return;
    setPendingRevocation(null);
    setMutationError(null);
  }

  async function revoke(sessionId: string, isCurrent: boolean) {
    setMutating(true);
    setMutationError(null);
    setMutationNotice(null);
    try {
      await api.revokeSession(session.accessJwt, sessionId);
      if (isCurrent) {
        await logout();
        setPendingRevocation(null);
        navigate("/app/login", { replace: true });
      } else {
        await resource.reload();
        setPendingRevocation(null);
      }
      setMutationNotice(t("sessions.sessionRevoked"));
    } catch (caught) {
      setMutationError(
        caught instanceof Error ? caught.message : t("sessions.failedToRevoke"),
      );
    } finally {
      setMutating(false);
    }
  }

  async function revokeOthers() {
    const count =
      resource.data?.sessions.filter((item) => !item.isCurrent).length ?? 0;
    if (count === 0) return;
    setMutating(true);
    setMutationError(null);
    setMutationNotice(null);
    try {
      await api.revokeAllSessions(session.accessJwt);
      await resource.reload();
      setPendingRevocation(null);
      setMutationNotice(t("sessions.allSessionsRevoked"));
    } catch (caught) {
      setMutationError(
        caught instanceof Error
          ? caught.message
          : t("sessions.failedToRevokeAll"),
      );
    } finally {
      setMutating(false);
    }
  }

  const heading = (
    <PageHeading
      title={t("dashboard.navSessions")}
      description={t("sessions.description")}
    />
  );

  if (resource.loading && !resource.data) {
    return (
      <div className="mx-auto grid w-full max-w-[52rem] gap-6" aria-busy="true">
        {heading}
        <SettingsSection title={t("sessions.listTitle")}>
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
          {resource.error ?? t("sessions.failedToLoad")}
        </Alert>
      </div>
    );
  }

  const otherSessionCount = resource.data.sessions.filter(
    (item) => !item.isCurrent,
  ).length;
  const revocationDialogOpen = pendingRevocation !== null;
  const revocationDescription = pendingRevocation
    ? pendingRevocation.kind === "others"
      ? t("sessions.revokeAllConfirm", { count: pendingRevocation.count })
      : t(
          pendingRevocation.session.isCurrent
            ? "sessions.revokeCurrentConfirm"
            : "sessions.revokeConfirm",
        )
    : undefined;
  const revocationTitle =
    pendingRevocation?.kind === "others"
      ? t("sessions.revokeAll")
      : pendingRevocation?.session.isCurrent
        ? t("sessions.signOut")
        : t("sessions.revoke");

  return (
    <div className="mx-auto grid w-full max-w-[52rem] gap-6">
      {heading}
      {resource.error ? <Alert tone="error">{resource.error}</Alert> : null}
      {mutationError && !revocationDialogOpen ? (
        <Alert tone="error">{mutationError}</Alert>
      ) : null}
      {mutationNotice ? <Alert tone="success">{mutationNotice}</Alert> : null}

      <SettingsSection
        title={t("sessions.listTitle")}
        description={t("sessions.listDescription")}
        action={
          <Button
            type="button"
            variant="ghost"
            size="compact"
            disabled={mutating || resource.loading}
            onClick={() => {
              setMutationNotice(null);
              void resource.reload();
            }}
          >
            <IconRefresh
              className={`size-4 ${resource.loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {t("common.refresh")}
          </Button>
        }
      >
        {resource.data.sessions.length === 0 ? (
          <SettingsItem title={t("sessions.noSessions")} />
        ) : (
          resource.data.sessions.map((item) => (
            <SettingsItem
              key={item.id}
              technical
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{sessionName(item)}</span>
                  {item.isCurrent ? (
                    <SettingsTag tone="accent">
                      {t("sessions.current")}
                    </SettingsTag>
                  ) : null}
                  <SettingsTag>{sessionTypeLabel(item)}</SettingsTag>
                </span>
              }
              description={
                <span className="flex flex-wrap gap-x-2">
                  <span>
                    {t("sessions.created")} {formatDateTime(item.createdAt)}
                  </span>
                  <span>
                    {t("sessions.expires")} {formatDateTime(item.expiresAt)}
                  </span>
                </span>
              }
              action={
                <Button
                  type="button"
                  variant={item.isCurrent ? "secondary" : "dangerOutline"}
                  size="compact"
                  disabled={mutating}
                  aria-haspopup="dialog"
                  onClick={() => requestSessionRevocation(item)}
                >
                  {item.isCurrent
                    ? t("sessions.signOut")
                    : t("sessions.revoke")}
                </Button>
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={t("sessions.controlsTitle")}>
        <SettingsRow
          label={t("sessions.otherSessions")}
          value={otherSessionCount.toLocaleString()}
          description={
            otherSessionCount > 0
              ? t("sessions.otherSessionsDescription")
              : t("sessions.noOtherSessions")
          }
          technical
          action={
            <Button
              type="button"
              variant="dangerOutline"
              size="compact"
              disabled={mutating || otherSessionCount === 0}
              aria-haspopup="dialog"
              onClick={requestOtherSessionRevocation}
            >
              {t("sessions.revokeAll")}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsDialog
        open={revocationDialogOpen}
        title={revocationTitle}
        description={revocationDescription}
        maxWidth="sm"
        closeDisabled={mutating}
        onClose={closeRevocationDialog}
      >
        {mutationError ? (
          <div className="mb-4">
            <Alert tone="error">{mutationError}</Alert>
          </div>
        ) : null}
        {pendingRevocation?.kind === "session" ? (
          <p className="mb-5 text-sm text-ctp-subtext0">
            {sessionName(pendingRevocation.session)}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={mutating}
            onClick={closeRevocationDialog}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="dangerOutline"
            disabled={mutating}
            onClick={() => {
              if (!pendingRevocation) return;
              if (pendingRevocation.kind === "others") {
                void revokeOthers();
                return;
              }
              void revoke(
                pendingRevocation.session.id,
                pendingRevocation.session.isCurrent,
              );
            }}
          >
            {revocationTitle}
          </Button>
        </div>
      </SettingsDialog>
    </div>
  );
}
