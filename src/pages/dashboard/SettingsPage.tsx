import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, DashboardPage } from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { logout, refreshSession } from "../../lib/auth.ts";
import { api, ApiError } from "../../lib/api.ts";
import {
  getInitialLocale,
  setLocale,
  useTranslation,
  type SupportedLocale,
} from "../../lib/i18n.ts";
import { getSessionEmail } from "../../lib/types/api.ts";
import { unsafeAsHandle } from "../../lib/types/branded.ts";
import { SettingsSections, type SettingsEditor } from "./SettingsSections.tsx";

type Notice = { tone: "success" | "error" | "warning"; text: string };
type EmailUpdateStatus = {
  pending: boolean;
  authorized: boolean;
  newEmail?: string;
};

export function SettingsPage() {
  const session = useSession();
  const navigate = useNavigate();
  const t = useTranslation();
  const loadPreferences = useCallback(async () => {
    const [legacy, emailStatus, server] = await Promise.all([
      api.getLegacyLoginPreference(session.accessJwt),
      api
        .checkEmailUpdateStatus(session.accessJwt)
        .catch((): EmailUpdateStatus => ({
          pending: false,
          authorized: false,
        })),
      api.describeServer().catch(() => null),
    ]);
    return { legacy, emailStatus, server };
  }, [session.accessJwt]);
  const preferences = useAsync(loadPreferences);
  const [handle, setHandle] = useState("");
  const [activeEditor, setActiveEditor] = useState<SettingsEditor>(null);
  const [customHandle, setCustomHandle] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [email, setEmail] = useState("");
  const [emailInUse, setEmailInUse] = useState(false);
  const [emailToken, setEmailToken] = useState("");
  const [emailTokenRequired, setEmailTokenRequired] = useState(false);
  const [emailUpdateAuthorized, setEmailUpdateAuthorized] = useState(false);
  const [locale, setLocaleValue] =
    useState<SupportedLocale>(getInitialLocale());
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [deleteToken, setDeleteToken] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const automaticEmailCompletion = useRef<string | null>(null);
  const emailAvailabilityRequest = useRef(0);

  useEffect(() => {
    const accessJwt = session.accessJwt;
    queueMicrotask(() => {
      if (accessJwt !== session.accessJwt) return;
      setHandle("");
      setActiveEditor(null);
      setCustomHandle(false);
      setSelectedDomain("");
      setEmail("");
      setEmailInUse(false);
      setEmailToken("");
      setEmailTokenRequired(false);
      setEmailUpdateAuthorized(false);
      automaticEmailCompletion.current = null;
      emailAvailabilityRequest.current += 1;
    });
  }, [session.accessJwt]);

  useEffect(() => {
    if (!preferences.data) return;
    const loaded = preferences.data;
    queueMicrotask(() => {
      setLegacyLogin(loaded.legacy.allowLegacyLogin);
      setSelectedDomain(
        (current) => current || loaded.server?.availableUserDomains[0] || "",
      );
      const status = loaded.emailStatus;
      if (!status.pending) return;
      setActiveEditor("email");
      setEmailTokenRequired(true);
      setEmailUpdateAuthorized(status.authorized);
      if (status.newEmail) setEmail(status.newEmail);
    });
  }, [preferences.data]);

  useEffect(() => {
    if (!emailTokenRequired || emailUpdateAuthorized) return;
    let active = true;
    const interval = setInterval(() => {
      void api
        .checkEmailUpdateStatus(session.accessJwt)
        .then((status) => {
          if (!active) return;
          if (!status.pending) {
            setEmailTokenRequired(false);
            setEmailToken("");
            setNotice({
              tone: "warning",
              text: "The email update request expired. Start again.",
            });
            return;
          }
          if (status.newEmail) setEmail(status.newEmail);
          if (status.authorized) setEmailUpdateAuthorized(true);
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [emailTokenRequired, emailUpdateAuthorized, session.accessJwt]);

  useEffect(() => {
    const nextEmail = email.trim();
    if (
      !emailUpdateAuthorized ||
      !nextEmail ||
      automaticEmailCompletion.current === nextEmail
    )
      return;
    automaticEmailCompletion.current = nextEmail;
    setSaving(true);
    setNotice(null);
    void api
      .updateEmail(session.accessJwt, nextEmail)
      .then(async () => {
        await refreshSession();
        setEmail("");
        setEmailToken("");
        setEmailTokenRequired(false);
        setEmailUpdateAuthorized(false);
        setEmailInUse(false);
        setActiveEditor(null);
        setNotice({ tone: "success", text: "Email updated." });
      })
      .catch((caught) => {
        setNotice({
          tone: "error",
          text:
            caught instanceof ApiError
              ? caught.message
              : "Could not update the email.",
        });
      })
      .finally(() => setSaving(false));
  }, [email, emailUpdateAuthorized, session.accessJwt]);

  async function run(
    action: () => Promise<void>,
    success: string,
  ): Promise<boolean> {
    setSaving(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "success", text: success });
      return true;
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof ApiError ? caught.message : "The request failed.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveHandle(event: React.FormEvent) {
    event.preventDefault();
    const updated = await run(async () => {
      const nextHandle = customHandle
        ? handle.trim()
        : `${handle.trim()}.${selectedDomain}`;
      await api.updateHandle(session.accessJwt, unsafeAsHandle(nextHandle));
      await refreshSession();
      setHandle("");
    }, "Handle updated.");
    if (updated) setActiveEditor(null);
  }

  async function checkEmailAvailability() {
    const nextEmail = email.trim();
    if (!nextEmail || !nextEmail.includes("@")) {
      setEmailInUse(false);
      return;
    }
    const request = ++emailAvailabilityRequest.current;
    try {
      const result = await api.checkEmailInUse(nextEmail);
      if (request === emailAvailabilityRequest.current)
        setEmailInUse(result.inUse);
    } catch {
      if (request === emailAvailabilityRequest.current) setEmailInUse(false);
    }
  }

  function clearEmailUpdate() {
    setEmail("");
    setEmailToken("");
    setEmailTokenRequired(false);
    setEmailUpdateAuthorized(false);
    setEmailInUse(false);
    automaticEmailCompletion.current = null;
  }

  function changeEmailInput(nextEmail: string) {
    setEmail(nextEmail);
    setEmailInUse(false);
    automaticEmailCompletion.current = null;
    emailAvailabilityRequest.current += 1;
  }

  function cancelHandleEditor() {
    setHandle("");
    setCustomHandle(false);
    setActiveEditor(null);
  }

  function cancelEmailEditor() {
    clearEmailUpdate();
    setActiveEditor(null);
  }

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const nextEmail = email.trim();
      if (emailTokenRequired) {
        await api.updateEmail(
          session.accessJwt,
          nextEmail,
          emailUpdateAuthorized ? undefined : emailToken.trim(),
        );
        await refreshSession();
        clearEmailUpdate();
        setActiveEditor(null);
        setNotice({ tone: "success", text: "Email updated." });
      } else {
        const result = await api.requestEmailUpdate(
          session.accessJwt,
          nextEmail,
        );
        if (result.tokenRequired) {
          setEmailTokenRequired(true);
          setEmailUpdateAuthorized(false);
          setNotice({
            tone: "warning",
            text: "Enter the code sent to your current address, or open its authorization link.",
          });
        } else {
          await api.updateEmail(session.accessJwt, nextEmail);
          await refreshSession();
          clearEmailUpdate();
          setActiveEditor(null);
          setNotice({ tone: "success", text: "Email updated." });
        }
      }
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "Could not update the email.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function changeLocale(next: SupportedLocale) {
    setLocaleValue(next);
    setLocale(next);
    await run(
      () => api.updateLocale(session.accessJwt, next).then(() => undefined),
      t("common.save"),
    );
  }
  async function changeLegacyLogin(next: boolean) {
    setLegacyLogin(next);
    await run(
      () =>
        api
          .updateLegacyLoginPreference(session.accessJwt, next)
          .then(() => undefined),
      next
        ? "Legacy password sign-in enabled."
        : "Legacy password sign-in disabled.",
    );
  }

  async function requestDelete() {
    await run(async () => {
      await api.requestAccountDelete(session.accessJwt);
      setDeleteRequested(true);
    }, "Check your verification channel for the deletion code.");
  }
  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    if (
      !confirm(
        "Permanently delete this account and its repository? This cannot be undone.",
      )
    )
      return;
    setSaving(true);
    setNotice(null);
    try {
      await api.deleteAccount(session.did, deletePassword, deleteToken.trim());
      await logout();
      navigate("/app/login", { replace: true });
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "Could not delete the account.",
      });
      setSaving(false);
    }
  }

  const availableDomains = preferences.data?.server?.availableUserDomains ?? [];
  const canSaveHandle = Boolean(
    handle.trim() && (customHandle || selectedDomain),
  );

  return (
    <DashboardPage
      title={t("dashboard.navSettings")}
      description={t("settings.subtitle")}
    >
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {preferences.error ? (
        <Alert tone="error">{preferences.error}</Alert>
      ) : null}
      <SettingsSections
        t={t}
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}
        cancelHandleEditor={cancelHandleEditor}
        cancelEmailEditor={cancelEmailEditor}
        sessionHandle={session.handle}
        sessionDid={session.did}
        sessionEmail={getSessionEmail(session)}
        customHandle={customHandle}
        setCustomHandle={setCustomHandle}
        handle={handle}
        setHandle={setHandle}
        selectedDomain={selectedDomain}
        setSelectedDomain={setSelectedDomain}
        availableDomains={availableDomains}
        saving={saving}
        canSaveHandle={canSaveHandle}
        saveHandle={saveHandle}
        email={email}
        changeEmailInput={changeEmailInput}
        emailInUse={emailInUse}
        emailToken={emailToken}
        setEmailToken={setEmailToken}
        emailTokenRequired={emailTokenRequired}
        emailUpdateAuthorized={emailUpdateAuthorized}
        checkEmailAvailability={checkEmailAvailability}
        saveEmail={saveEmail}
        locale={locale}
        changeLocale={changeLocale}
        legacyLogin={legacyLogin}
        changeLegacyLogin={changeLegacyLogin}
        hasMfa={preferences.data?.legacy.hasMfa ?? false}
        deleteRequested={deleteRequested}
        deleteToken={deleteToken}
        setDeleteToken={setDeleteToken}
        deletePassword={deletePassword}
        setDeletePassword={setDeletePassword}
        requestDelete={requestDelete}
        deleteAccount={deleteAccount}
      />
    </DashboardPage>
  );
}
