import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
} from "../../components/ui.tsx";
import {
  localeNames,
  supportedLocales,
  type SupportedLocale,
  type useTranslation,
} from "../../lib/i18n.ts";

type Translate = ReturnType<typeof useTranslation>;

export function SettingsSections({
  t,
  sessionHandle,
  sessionDid,
  sessionEmail,
  customHandle,
  setCustomHandle,
  handle,
  setHandle,
  selectedDomain,
  setSelectedDomain,
  availableDomains,
  saving,
  canSaveHandle,
  saveHandle,
  email,
  changeEmailInput,
  emailInUse,
  emailToken,
  setEmailToken,
  emailTokenRequired,
  emailUpdateAuthorized,
  checkEmailAvailability,
  saveEmail,
  clearEmailUpdate,
  locale,
  changeLocale,
  legacyLogin,
  changeLegacyLogin,
  hasMfa,
  deleteRequested,
  deleteToken,
  setDeleteToken,
  deletePassword,
  setDeletePassword,
  requestDelete,
  deleteAccount,
}: {
  t: Translate;
  sessionHandle: string;
  sessionDid: string;
  sessionEmail?: string;
  customHandle: boolean;
  setCustomHandle: Dispatch<SetStateAction<boolean>>;
  handle: string;
  setHandle: Dispatch<SetStateAction<string>>;
  selectedDomain: string;
  setSelectedDomain: Dispatch<SetStateAction<string>>;
  availableDomains: string[];
  saving: boolean;
  canSaveHandle: boolean;
  saveHandle: FormEventHandler<HTMLFormElement>;
  email: string;
  changeEmailInput: (email: string) => void;
  emailInUse: boolean;
  emailToken: string;
  setEmailToken: Dispatch<SetStateAction<string>>;
  emailTokenRequired: boolean;
  emailUpdateAuthorized: boolean;
  checkEmailAvailability: () => Promise<void>;
  saveEmail: FormEventHandler<HTMLFormElement>;
  clearEmailUpdate: () => void;
  locale: SupportedLocale;
  changeLocale: (locale: SupportedLocale) => Promise<void>;
  legacyLogin: boolean;
  changeLegacyLogin: (enabled: boolean) => Promise<void>;
  hasMfa: boolean;
  deleteRequested: boolean;
  deleteToken: string;
  setDeleteToken: Dispatch<SetStateAction<string>>;
  deletePassword: string;
  setDeletePassword: Dispatch<SetStateAction<string>>;
  requestDelete: () => Promise<void>;
  deleteAccount: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-mono font-semibold text-ctp-text">
          {t("settings.changeHandle")}
        </h2>
        <p className="mt-1 text-sm text-ctp-subtext0">
          {t("settings.currentHandle", { handle: sessionHandle })}
        </p>
        <p className="mt-1 text-sm text-ctp-subtext0">
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
          <div className="mt-4 rounded border border-ctp-surface1 bg-ctp-crust p-4 text-xs leading-5 text-ctp-subtext0">
            <p>{t("settings.setupMethodsIntro")}</p>
            <code className="mt-2 block break-all text-ctp-lavender">
              _atproto.{handle || "your-domain.example"} TXT &quot;did=
              {sessionDid}&quot;
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
        <dl className="mt-6 border-t border-ctp-surface0 pt-4 text-sm">
          <dt className="text-ctp-overlay1">DID</dt>
          <dd className="mt-1 font-mono text-xs break-all text-ctp-subtext1">
            {sessionDid}
          </dd>
        </dl>
      </Card>
      <Card className="p-5">
        <h2 className="font-mono font-semibold text-ctp-text">
          {t("settings.changeEmail")}
        </h2>
        {sessionEmail ? (
          <p className="mt-3 text-xs text-ctp-overlay1">
            {t("settings.currentEmail", {
              email: sessionEmail ?? "",
            })}
          </p>
        ) : null}
        <form className="mt-5 grid gap-4" onSubmit={saveEmail}>
          <Field label={t("settings.newEmail")}>
            <Input
              type="email"
              value={email}
              onChange={(event) => changeEmailInput(event.target.value)}
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
            <Alert tone="success">{t("settings.emailUpdateAuthorized")}</Alert>
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
          <div className="flex items-start gap-3 rounded border border-ctp-surface1 p-4">
            <input
              id="legacy-login"
              aria-labelledby="legacy-login-label legacy-login-description"
              className="mt-1 size-4 accent-ctp-lavender"
              type="checkbox"
              checked={legacyLogin}
              disabled={saving || !hasMfa}
              onChange={(event) => void changeLegacyLogin(event.target.checked)}
            />
            <span>
              <span
                id="legacy-login-label"
                className="block text-sm font-medium text-ctp-text"
              >
                {t("security.legacyLogin")}
              </span>
              <span
                id="legacy-login-description"
                className="mt-1 block text-xs leading-5 text-ctp-overlay1"
              >
                {t("security.legacyLoginDescription")}
              </span>
            </span>
          </div>
        </div>
      </Card>
      <Card className="border-ctp-red/40 p-5">
        <h2 className="font-mono font-semibold text-ctp-red">Delete account</h2>
        <p className="mt-1 text-sm text-ctp-subtext0">
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
  );
}
