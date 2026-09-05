import { useState, type FormEvent } from "react";
import { Alert, PageHeading } from "../../components/ui.tsx";
import {
  getInitialLocale,
  setLocale,
  useTranslation,
  type SupportedLocale,
} from "../../lib/i18n.ts";
import {
  SettingsSections,
  type SettingsEditor,
} from "../dashboard/SettingsSections.tsx";

type PreviewNotice = {
  tone: "success" | "warning";
  text: string;
};

export function SettingsPreviewPage() {
  const t = useTranslation();
  const [activeEditor, setActiveEditor] = useState<SettingsEditor>(null);
  const [sessionHandle, setSessionHandle] = useState("alice.pacifico.test");
  const [sessionEmail, setSessionEmail] = useState("alice@example.com");
  const [customHandle, setCustomHandle] = useState(false);
  const [handle, setHandle] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("pacifico.test");
  const [email, setEmail] = useState("");
  const [emailInUse, setEmailInUse] = useState(false);
  const [emailToken, setEmailToken] = useState("");
  const [emailTokenRequired, setEmailTokenRequired] = useState(false);
  const [locale, setPreviewLocale] =
    useState<SupportedLocale>(getInitialLocale());
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [deleteToken, setDeleteToken] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [notice, setNotice] = useState<PreviewNotice | null>(null);

  function cancelHandleEditor() {
    setHandle("");
    setCustomHandle(false);
    setActiveEditor(null);
  }

  function cancelEmailEditor() {
    setEmail("");
    setEmailInUse(false);
    setEmailToken("");
    setEmailTokenRequired(false);
    setActiveEditor(null);
  }

  function saveHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextHandle = customHandle
      ? handle.trim()
      : `${handle.trim()}.${selectedDomain}`;
    setSessionHandle(nextHandle);
    cancelHandleEditor();
    setNotice({ tone: "success", text: "Preview handle updated." });
  }

  function changeEmailInput(nextEmail: string) {
    setEmail(nextEmail);
    setEmailInUse(false);
  }

  async function checkEmailAvailability() {
    setEmailInUse(email.trim().toLowerCase() === "used@example.com");
  }

  function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailTokenRequired) {
      setEmailTokenRequired(true);
      setNotice({
        tone: "warning",
        text: "Enter any confirmation code to preview the second step.",
      });
      return;
    }
    setSessionEmail(email.trim());
    cancelEmailEditor();
    setNotice({ tone: "success", text: "Preview email updated." });
  }

  async function changeLocale(nextLocale: SupportedLocale) {
    setPreviewLocale(nextLocale);
    setLocale(nextLocale);
  }

  async function changeLegacyLogin(enabled: boolean) {
    setLegacyLogin(enabled);
  }

  async function requestDelete() {
    setDeleteRequested(true);
    setNotice({
      tone: "warning",
      text: "Enter any code and password to preview the deletion form.",
    });
  }

  function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice({
      tone: "warning",
      text: "Preview only. No account was deleted.",
    });
  }

  return (
    <main className="min-h-screen bg-ctp-base px-4 py-8 text-ctp-text sm:px-6">
      <div className="mx-auto grid max-w-[52rem] gap-6">
        <div className="rounded border border-ctp-blue/40 bg-ctp-blue/10 px-4 py-3 font-mono text-xs text-ctp-blue">
          Development preview at /app/dev/settings. Changes stay in this tab.
        </div>
        <PageHeading
          title={t("dashboard.navSettings")}
          description={t("settings.subtitle")}
        />
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        <SettingsSections
          t={t}
          activeEditor={activeEditor}
          setActiveEditor={setActiveEditor}
          cancelHandleEditor={cancelHandleEditor}
          cancelEmailEditor={cancelEmailEditor}
          sessionHandle={sessionHandle}
          sessionDid="did:plc:previewaccount"
          sessionEmail={sessionEmail}
          customHandle={customHandle}
          setCustomHandle={setCustomHandle}
          handle={handle}
          setHandle={setHandle}
          selectedDomain={selectedDomain}
          setSelectedDomain={setSelectedDomain}
          availableDomains={["pacifico.test", "example.test"]}
          saving={false}
          canSaveHandle={Boolean(
            handle.trim() && (customHandle || selectedDomain),
          )}
          saveHandle={saveHandle}
          email={email}
          changeEmailInput={changeEmailInput}
          emailInUse={emailInUse}
          emailToken={emailToken}
          setEmailToken={setEmailToken}
          emailTokenRequired={emailTokenRequired}
          emailUpdateAuthorized={false}
          checkEmailAvailability={checkEmailAvailability}
          saveEmail={saveEmail}
          locale={locale}
          changeLocale={changeLocale}
          legacyLogin={legacyLogin}
          changeLegacyLogin={changeLegacyLogin}
          hasMfa={true}
          deleteRequested={deleteRequested}
          deleteToken={deleteToken}
          setDeleteToken={setDeleteToken}
          deletePassword={deletePassword}
          setDeletePassword={setDeletePassword}
          requestDelete={requestDelete}
          deleteAccount={deleteAccount}
        />
      </div>
    </main>
  );
}
