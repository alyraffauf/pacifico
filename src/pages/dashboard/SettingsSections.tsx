import { IconCheck, IconCopy } from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEventHandler,
  type SetStateAction,
} from "react";
import {
  Alert,
  Button,
  Field,
  Input,
  SegmentedControl,
  Select,
  SettingsContent,
  SettingsItem,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "../../components/ui.tsx";
import {
  localeNames,
  supportedLocales,
  type SupportedLocale,
  type useTranslation,
} from "../../lib/i18n.ts";

type Translate = ReturnType<typeof useTranslation>;
export type SettingsEditor = "handle" | "email" | null;

type SettingsSectionsProps = {
  t: Translate;
  activeEditor: SettingsEditor;
  setActiveEditor: Dispatch<SetStateAction<SettingsEditor>>;
  cancelHandleEditor: () => void;
  cancelEmailEditor: () => void;
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
};

export function SettingsSections({
  t,
  activeEditor,
  setActiveEditor,
  cancelHandleEditor,
  cancelEmailEditor,
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
}: SettingsSectionsProps) {
  const [didCopied, setDidCopied] = useState(false);
  const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const deleteTokenInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(copyFeedbackTimeout.current), []);

  useEffect(() => {
    if (activeEditor === "handle") handleInput.current?.focus();
    if (activeEditor === "email") emailInput.current?.focus();
  }, [activeEditor]);

  useEffect(() => {
    if (deleteRequested) deleteTokenInput.current?.focus();
  }, [deleteRequested]);

  async function copyDid() {
    try {
      await navigator.clipboard.writeText(sessionDid);
      setDidCopied(true);
      clearTimeout(copyFeedbackTimeout.current);
      copyFeedbackTimeout.current = setTimeout(() => setDidCopied(false), 2000);
    } catch {
      setDidCopied(false);
    }
  }

  return (
    <div className="grid gap-6">
      <SettingsSection title={t("settings.identity")}>
        <SettingsRow
          label={t("settings.handle")}
          value={`@${sessionHandle}`}
          technical
          action={
            <Button
              type="button"
              variant="ghost"
              size="compact"
              aria-controls="settings-handle-editor"
              aria-expanded={activeEditor === "handle"}
              onClick={() => setActiveEditor("handle")}
            >
              {t("settings.changeHandleButton")}
            </Button>
          }
        >
          {activeEditor === "handle" ? (
            <form
              id="settings-handle-editor"
              className="grid gap-4"
              onSubmit={saveHandle}
            >
              <p className="text-xs leading-5 text-ctp-overlay1">
                {t("settings.didUnchanged")}
              </p>
              <SegmentedControl
                label={t("settings.handle")}
                value={customHandle ? "custom" : "pds"}
                choices={[
                  { value: "pds", label: t("settings.pdsHandle") },
                  { value: "custom", label: t("settings.customDomain") },
                ]}
                disabled={saving}
                onChange={(next) => setCustomHandle(next === "custom")}
              />
              {customHandle ? (
                <div className="rounded border border-ctp-surface1 bg-ctp-crust p-4 text-xs leading-5 text-ctp-subtext0">
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
              {customHandle ? (
                <Field label={t("settings.yourDomain")}>
                  <Input
                    ref={handleInput}
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    autoComplete="username"
                    placeholder={t("settings.yourDomainPlaceholder")}
                    disabled={saving}
                    required
                  />
                </Field>
              ) : (
                <div className="grid gap-2">
                  <label
                    htmlFor="settings-handle"
                    className="font-mono text-sm font-semibold text-ctp-subtext1"
                  >
                    {t("settings.newHandle")}
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <Input
                      id="settings-handle"
                      ref={handleInput}
                      value={handle}
                      onChange={(event) => setHandle(event.target.value)}
                      autoComplete="username"
                      placeholder={t("settings.newHandlePlaceholder")}
                      disabled={saving}
                      required
                    />
                    <Select
                      aria-label={t("settings.domainSuffix")}
                      value={selectedDomain}
                      onChange={(event) =>
                        setSelectedDomain(event.target.value)
                      }
                      disabled={saving || availableDomains.length === 0}
                    >
                      {availableDomains.map((domain) => (
                        <option key={domain} value={domain}>
                          .{domain}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button disabled={saving || !canSaveHandle}>
                  {customHandle
                    ? t("settings.verifyAndUpdate")
                    : t("settings.changeHandleButton")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={cancelHandleEditor}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          ) : null}
        </SettingsRow>

        <SettingsRow
          label={t("settings.email")}
          value={sessionEmail || t("settings.notSet")}
          action={
            <Button
              type="button"
              variant="ghost"
              size="compact"
              aria-controls="settings-email-editor"
              aria-expanded={activeEditor === "email"}
              onClick={() => setActiveEditor("email")}
            >
              {t("settings.changeEmailButton")}
            </Button>
          }
        >
          {activeEditor === "email" ? (
            <form
              id="settings-email-editor"
              className="grid gap-4"
              onSubmit={saveEmail}
            >
              <Field label={t("settings.newEmail")}>
                <Input
                  ref={emailInput}
                  type="email"
                  value={email}
                  onChange={(event) => changeEmailInput(event.target.value)}
                  onBlur={() => void checkEmailAvailability()}
                  autoComplete="email"
                  placeholder={t("settings.newEmailPlaceholder")}
                  disabled={saving || emailUpdateAuthorized}
                  required
                />
                {emailInUse ? (
                  <output className="mt-1 block text-xs text-ctp-yellow">
                    {t("settings.emailInUseWarning")}
                  </output>
                ) : null}
              </Field>
              {emailTokenRequired && !emailUpdateAuthorized ? (
                <Field
                  label={t("settings.confirmationCode")}
                  hint={t("settings.emailTokenHint")}
                >
                  <Input
                    value={emailToken}
                    onChange={(event) => setEmailToken(event.target.value)}
                    autoComplete="one-time-code"
                    placeholder={t("settings.confirmationCodePlaceholder")}
                    disabled={saving}
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
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={cancelEmailEditor}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          ) : null}
        </SettingsRow>

        <SettingsRow
          label="DID"
          technical
          value={
            <>
              <span className="text-xs break-all">{sessionDid}</span>
              <span className="sr-only" aria-live="polite">
                {didCopied ? t("settings.didCopied") : ""}
              </span>
            </>
          }
          action={
            <Button
              type="button"
              variant="ghost"
              size="compact"
              onClick={() => void copyDid()}
            >
              {didCopied ? (
                <IconCheck className="size-4" aria-hidden="true" />
              ) : (
                <IconCopy className="size-4" aria-hidden="true" />
              )}
              {didCopied ? t("common.copied") : t("common.copyToClipboard")}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.preferences")}>
        <SettingsRow
          label={t("settings.language")}
          value={
            <div className="max-w-64">
              <Select
                compact
                aria-label={t("settings.language")}
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
            </div>
          }
        />
        <SettingsRow
          label={t("settings.passwordSignIn")}
          value={legacyLogin ? t("settings.enabled") : t("settings.disabled")}
          description={
            <>
              {t("settings.legacySecurityDescription")}
              {!hasMfa ? (
                <span className="mt-1 block text-ctp-yellow">
                  {t("settings.legacyMfaRequired")}
                </span>
              ) : null}
            </>
          }
          action={
            <SettingsSwitch
              label={t("settings.passwordSignIn")}
              checked={legacyLogin}
              disabled={saving || !hasMfa}
              onCheckedChange={(checked) => void changeLegacyLogin(checked)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.dangerZone")} tone="danger">
        {deleteRequested ? (
          <SettingsContent>
            <p className="mb-4 text-sm leading-6 text-ctp-subtext0">
              {t("settings.deleteWarning")}
            </p>
            <form className="grid gap-4" onSubmit={deleteAccount}>
              <Field label={t("settings.confirmationCode")}>
                <Input
                  ref={deleteTokenInput}
                  value={deleteToken}
                  onChange={(event) => setDeleteToken(event.target.value)}
                  autoComplete="one-time-code"
                  placeholder={t("settings.confirmationCodePlaceholder")}
                  disabled={saving}
                  required
                />
              </Field>
              <Field label={t("settings.yourPassword")}>
                <Input
                  type="password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder={t("settings.yourPasswordPlaceholder")}
                  disabled={saving}
                  required
                />
              </Field>
              <Button
                variant="dangerOutline"
                className="justify-self-start"
                disabled={saving || !deleteToken.trim() || !deletePassword}
              >
                {t("settings.permanentlyDelete")}
              </Button>
            </form>
          </SettingsContent>
        ) : (
          <SettingsItem
            title={t("settings.deleteAccount")}
            description={t("settings.deleteWarning")}
            action={
              <Button
                variant="dangerOutline"
                disabled={saving}
                onClick={() => void requestDelete()}
              >
                {t("settings.requestDeletion")}
              </Button>
            }
          />
        )}
      </SettingsSection>
    </div>
  );
}
