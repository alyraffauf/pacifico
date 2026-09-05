import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeading,
  Select,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { logout, refreshSession } from "../../lib/auth.ts";
import { api, ApiError } from "../../lib/api.ts";
import {
  getInitialLocale,
  localeNames,
  setLocale,
  supportedLocales,
  useTranslation,
  type SupportedLocale,
} from "../../lib/i18n.ts";
import { getSessionEmail } from "../../lib/types/api.ts";
import { unsafeAsHandle } from "../../lib/types/branded.ts";

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
  const preferences = useAsync(async () => {
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
  const [handle, setHandle] = useState("");
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
    setHandle("");
    setCustomHandle(false);
    setSelectedDomain("");
    setEmail("");
    setEmailInUse(false);
    setEmailToken("");
    setEmailTokenRequired(false);
    setEmailUpdateAuthorized(false);
    automaticEmailCompletion.current = null;
    emailAvailabilityRequest.current += 1;
  }, [session.accessJwt]);

  useEffect(() => {
    if (!preferences.data) return;
    setLegacyLogin(preferences.data.legacy.allowLegacyLogin);
    setSelectedDomain(
      (current) =>
        current || preferences.data?.server?.availableUserDomains[0] || "",
    );
    const status = preferences.data.emailStatus;
    if (!status.pending) return;
    setEmailTokenRequired(true);
    setEmailUpdateAuthorized(status.authorized);
    if (status.newEmail) setEmail(status.newEmail);
  }, [preferences.data, session.accessJwt]);

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

  async function run(action: () => Promise<void>, success: string) {
    setSaving(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "success", text: success });
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof ApiError ? caught.message : "The request failed.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveHandle(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const nextHandle = customHandle
        ? handle.trim()
        : `${handle.trim()}.${selectedDomain}`;
      await api.updateHandle(session.accessJwt, unsafeAsHandle(nextHandle));
      await refreshSession();
      setHandle("");
    }, "Handle updated.");
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
    <div className="grid gap-6">
      <PageHeading
        title={t("dashboard.navSettings")}
        description={t("settings.messages")}
      />
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {preferences.error ? (
        <Alert tone="error">{preferences.error}</Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-mono font-semibold text-ctp-text">
            {t("settings.changeHandle")}
          </h2>
          <p className="mt-1 text-sm text-ctp-subtext-0">
            {t("settings.currentHandle")}: @{session.handle}
          </p>
          <p className="mt-1 text-sm text-ctp-subtext-0">
            Your DID remains the same when the handle changes.
          </p>
          <div className="mt-5 flex gap-2">
            <Button
              type="button"
              variant={customHandle ? "ghost" : "secondary"}
              onClick={() => setCustomHandle(false)}
            >
              {t("settings.pdsHandle")}
            </Button>
            <Button
              type="button"
              variant={customHandle ? "secondary" : "ghost"}
              onClick={() => setCustomHandle(true)}
            >
              {t("settings.customDomain")}
            </Button>
          </div>
          {customHandle ? (
            <div className="mt-4 rounded border border-ctp-surface-1 bg-ctp-crust p-4 text-xs leading-5 text-ctp-subtext-0">
              <p>{t("settings.setupMethodsIntro")}</p>
              <code className="mt-2 block break-all text-ctp-lavender">
                _atproto.{handle || "your-domain.example"} TXT &quot;did=
                {session.did}&quot;
              </code>
              <code className="mt-2 block break-all text-ctp-lavender">
                https://{handle || "your-domain.example"}
                /.well-known/atproto-did
              </code>
            </div>
          ) : null}
          <form className="mt-4 grid gap-4" onSubmit={saveHandle}>
            {customHandle ? (
              <Field label={t("settings.yourDomain")}>
                <Input
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  autoComplete="username"
                  placeholder={t("settings.yourDomainPlaceholder")}
                />
              </Field>
            ) : (
              <Field label={t("settings.newHandle")}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Input
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    autoComplete="username"
                  />
                  <Select
                    value={selectedDomain}
                    onChange={(event) => setSelectedDomain(event.target.value)}
                    disabled={availableDomains.length === 0}
                  >
                    {availableDomains.map((domain) => (
                      <option key={domain} value={domain}>
                        .{domain}
                      </option>
                    ))}
                  </Select>
                </div>
              </Field>
            )}
            <Button
              className="justify-self-start"
              disabled={saving || !canSaveHandle}
            >
              {customHandle
                ? t("settings.verifyAndUpdate")
                : t("settings.changeHandleButton")}
            </Button>
          </form>
          <dl className="mt-6 border-t border-ctp-surface-0 pt-4 text-sm">
            <dt className="text-ctp-overlay-1">DID</dt>
            <dd className="mt-1 break-all font-mono text-xs text-ctp-subtext-1">
              {session.did}
            </dd>
          </dl>
        </Card>
        <Card className="p-5">
          <h2 className="font-mono font-semibold text-ctp-text">
            {t("settings.changeEmail")}
          </h2>
          {getSessionEmail(session) ? (
            <p className="mt-3 text-xs text-ctp-overlay-1">
              {t("settings.currentEmail")}: {getSessionEmail(session)}
            </p>
          ) : null}
          <form className="mt-5 grid gap-4" onSubmit={saveEmail}>
            <Field label={t("settings.newEmail")}>
              <Input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailInUse(false);
                  automaticEmailCompletion.current = null;
                  emailAvailabilityRequest.current += 1;
                }}
                onBlur={() => void checkEmailAvailability()}
                autoComplete="email"
                disabled={saving || emailUpdateAuthorized}
                required
              />
              {emailInUse ? (
                <span className="mt-1 block text-xs text-ctp-yellow">
                  {t("settings.emailInUseWarning")}
                </span>
              ) : null}
            </Field>
            {emailTokenRequired && !emailUpdateAuthorized ? (
              <Field label={t("settings.confirmationCode")}>
                <Input
                  value={emailToken}
                  onChange={(event) => setEmailToken(event.target.value)}
                  autoComplete="one-time-code"
                  required
                />
              </Field>
            ) : null}
            {emailUpdateAuthorized ? (
              <Alert tone="success">
                {t("settings.emailUpdateAuthorized")}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  saving ||
                  !email.trim() ||
                  (emailTokenRequired &&
                    !emailUpdateAuthorized &&
                    !emailToken.trim())
                }
              >
                {emailTokenRequired
                  ? t("settings.confirmEmailChange")
                  : t("settings.changeEmailButton")}
              </Button>
              {emailTokenRequired ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={clearEmailUpdate}
                >
                  {t("common.cancel")}
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
        <Card className="p-5">
          <h2 className="font-mono font-semibold text-ctp-text">
            {t("settings.language")}
          </h2>
          <div className="mt-5 grid gap-5">
            <Field label={t("settings.language")}>
              <Select
                value={locale}
                disabled={saving}
                onChange={(event) =>
                  void changeLocale(event.target.value as SupportedLocale)
                }
              >
                {supportedLocales.map((item) => (
                  <option key={item} value={item}>
                    {localeNames[item]}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-start gap-3 rounded border border-ctp-surface-1 p-4">
              <input
                className="mt-1 size-4 accent-ctp-lavender"
                type="checkbox"
                checked={legacyLogin}
                disabled={saving || !preferences.data?.legacy.hasMfa}
                onChange={(event) =>
                  void changeLegacyLogin(event.target.checked)
                }
              />
              <span>
                <span className="block text-sm font-medium text-ctp-text">
                  {t("security.legacyLogin")}
                </span>
                <span className="mt-1 block text-xs leading-5 text-ctp-overlay-1">
                  {t("security.legacyLoginDescription")}
                </span>
              </span>
            </label>
          </div>
        </Card>
        <Card className="border-ctp-red/40 p-5">
          <h2 className="font-mono font-semibold text-ctp-red">
            Delete account
          </h2>
          <p className="mt-1 text-sm text-ctp-subtext-0">
            Permanently removes the account and repository.
          </p>
          {deleteRequested ? (
            <form className="mt-5 grid gap-4" onSubmit={deleteAccount}>
              <Field label="Deletion code">
                <Input
                  value={deleteToken}
                  onChange={(event) => setDeleteToken(event.target.value)}
                  autoComplete="one-time-code"
                  required
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Button
                variant="danger"
                className="justify-self-start"
                disabled={saving || !deleteToken.trim() || !deletePassword}
              >
                Delete permanently
              </Button>
            </form>
          ) : (
            <Button
              variant="danger"
              className="mt-5"
              disabled={saving}
              onClick={() => void requestDelete()}
            >
              Request deletion code
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
