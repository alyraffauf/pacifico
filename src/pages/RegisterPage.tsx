import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import {
  hasBotVerification,
  useBotVerificationPolling,
} from "../components/ChannelVerificationPrompt.tsx";
import { Alert, Loading } from "../components/ui.tsx";
import { setSession } from "../lib/auth.ts";
import { api, ApiError } from "../lib/api.ts";
import {
  createServiceJwt,
  generateDidDocument,
  generateKeypair,
} from "../lib/crypto.ts";
import { performPasskeyRegistration } from "../lib/flows/perform-passkey-registration.ts";
import { getSiteHostname } from "../lib/site.ts";
import type {
  DidType,
  ServerDescription,
  VerificationChannel,
} from "../lib/types/api.ts";
import {
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
} from "../lib/types/branded.ts";
import {
  clearRegistrationState,
  loadRegistrationState,
  saveRegistrationState,
} from "../lib/registration/storage.ts";
import type {
  RegistrationStep,
  SessionState,
} from "../lib/registration/types.ts";
import { getPublicPdsEndpoint } from "../lib/pacifico/registration.ts";

import {
  AccountDetailsView,
  CredentialView,
  DidSetupView,
  VerificationView,
  type RegistrationAccount as Account,
  type RegistrationFormState,
  type RegistrationMode as Mode,
  type RegistrationStepView as Step,
} from "./RegistrationViews.tsx";

const storedStepByPageStep: Record<Step, RegistrationStep> = {
  info: "info",
  key: "key-choice",
  document: "initial-did-doc",
  creating: "creating",
  passkey: "passkey",
  "app-password": "app-password",
  verify: "verify",
  "updated-document": "updated-did-doc",
};

function restorePageStep(step: RegistrationStep): Step {
  if (step === "key-choice") return "key";
  if (step === "initial-did-doc") return "document";
  if (step === "updated-did-doc" || step === "activating")
    return "updated-document";
  if (step === "redirect-to-dashboard") return "info";
  return step;
}

export function RegisterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode: Mode = location.pathname.includes("register-password")
    ? "password"
    : "passkey";
  const restored = useMemo(() => {
    const saved = loadRegistrationState();
    return saved?.mode === mode ? saved : null;
  }, [mode]);
  const [server, setServer] = useState<ServerDescription | null>(null);
  const [step, setStep] = useState<Step>(() =>
    restored ? restorePageStep(restored.step) : "info",
  );
  const [form, setForm] = useState<RegistrationFormState>(() => ({
    handle: restored?.info.handle ?? "",
    domain: restored?.pdsHostname ?? "",
    email: restored?.info.email ?? "",
    password: "",
    confirmPassword: "",
    inviteCode: restored?.info.inviteCode ?? "",
    didType: restored?.info.didType ?? ("plc" as DidType),
    externalDid: restored?.info.externalDid ?? "",
    channel:
      restored?.info.verificationChannel ?? ("email" as VerificationChannel),
    discord: restored?.info.discordUsername ?? "",
    telegram: restored?.info.telegramUsername ?? "",
    signal: restored?.info.signalUsername ?? "",
    passkeyName: "",
  }));
  const [keyMode, setKeyMode] = useState<"reserved" | "byod">(
    restored?.externalDidWeb.keyMode ?? "reserved",
  );
  const [reservedKey, setReservedKey] = useState<string | undefined>(
    restored?.externalDidWeb.reservedSigningKey,
  );
  const [privateKey, setPrivateKey] = useState<Uint8Array | undefined>(
    restored?.externalDidWeb.byodPrivateKey,
  );
  const [documentText, setDocumentText] = useState(
    restored?.externalDidWeb.updatedDidDocument ??
      restored?.externalDidWeb.initialDidDocument ??
      "",
  );
  const [account, setAccount] = useState<Account | null>(
    restored?.account ?? null,
  );
  const [registrationSession, setRegistrationSession] =
    useState<SessionState | null>(restored?.session ?? null);
  const [verificationCode, setVerificationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .describeServer()
      .then((result) => {
        setServer(result);
        setForm((current) => ({
          ...current,
          domain:
            current.domain ||
            result.availableUserDomains[0] ||
            getSiteHostname(),
        }));
      })
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load server settings.",
        ),
      );
  }, []);
  useEffect(() => {
    if (!server || step === "info" || step === "creating") return;
    saveRegistrationState(
      mode,
      storedStepByPageStep[step],
      form.domain,
      {
        handle: form.handle,
        email: form.email,
        inviteCode: form.inviteCode || undefined,
        didType: form.didType,
        externalDid: form.externalDid || undefined,
        verificationChannel: form.channel,
        discordUsername: form.discord || undefined,
        telegramUsername: form.telegram || undefined,
        signalUsername: form.signal || undefined,
      },
      {
        keyMode,
        reservedSigningKey: reservedKey,
        byodPrivateKey: privateKey,
        initialDidDocument: step === "document" ? documentText : undefined,
        updatedDidDocument:
          step === "updated-document" ? documentText : undefined,
      },
      account,
      registrationSession,
    );
  }, [
    account,
    documentText,
    form,
    keyMode,
    mode,
    privateKey,
    registrationSession,
    reservedKey,
    server,
    step,
  ]);
  const fullHandle = useMemo(
    () => (form.handle.trim() ? `${form.handle.trim()}.${form.domain}` : ""),
    [form.handle, form.domain],
  );
  const availableChannels = server?.availableCommsChannels ?? ["email"];
  const usesBotVerification = hasBotVerification(form.channel);

  useBotVerificationPolling(
    step === "verify" && Boolean(account && server) && usesBotVerification,
    async () => {
      if (!account) return false;
      return (await api.checkChannelVerified(account.did, form.channel))
        .verified;
    },
    async () => {
      if (!account) return;
      const credential =
        mode === "passkey" ? account.appPassword : form.password;
      if (!credential) return;
      const auth = await api.createSession(account.did, credential);
      await finishVerifiedAccount(auth);
    },
  );

  function message(caught: unknown) {
    return caught instanceof ApiError
      ? caught.message
      : caught instanceof Error
        ? caught.message
        : "The request failed.";
  }
  function validate() {
    if (!form.handle.trim() || form.handle.includes("."))
      return "Enter only the part of the handle before the domain.";
    if (mode === "password" && form.password.length < 8)
      return "Use at least eight characters for the password.";
    if (mode === "password" && form.password !== form.confirmPassword)
      return "The passwords do not match.";
    if (server?.inviteCodeRequired && !form.inviteCode.trim())
      return "An invite code is required.";
    if (
      form.didType === "web-external" &&
      !form.externalDid.trim().startsWith("did:web:")
    )
      return "Enter a valid did:web identifier.";
    const identifier =
      form.channel === "email" ? form.email : form[form.channel];
    if (!identifier.trim())
      return `Enter the ${form.channel === "email" ? "email address" : `${form.channel} username`} used for verification.`;
    return null;
  }

  async function submitInfo(event: React.FormEvent) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (mode === "passkey" && !globalThis.PublicKeyCredential) {
      setError("This browser does not support passkeys.");
      return;
    }
    setError(null);
    if (form.didType === "web-external") setStep("key");
    else await createAccount();
  }

  async function prepareExternalDid(nextMode: "reserved" | "byod") {
    setBusy(true);
    setError(null);
    setKeyMode(nextMode);
    try {
      let publicKey: string;
      if (nextMode === "reserved") {
        const result = await api.reserveSigningKey(
          unsafeAsDid(form.externalDid.trim()),
        );
        setReservedKey(result.signingKey);
        publicKey = result.signingKey.replace("did:key:", "");
      } else {
        const result = generateKeypair();
        setPrivateKey(result.privateKey);
        publicKey = result.publicKeyMultibase;
      }
      if (!server) throw new Error("The server description is not available.");
      const doc = generateDidDocument(
        form.externalDid.trim(),
        publicKey,
        fullHandle,
        getPublicPdsEndpoint(server),
      );
      setDocumentText(JSON.stringify(doc, null, 2));
      setStep("document");
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  function commonParams() {
    return {
      inviteCode: form.inviteCode.trim() || undefined,
      didType: form.didType,
      did:
        form.didType === "web-external"
          ? unsafeAsDid(form.externalDid.trim())
          : undefined,
      signingKey:
        form.didType === "web-external" && keyMode === "reserved"
          ? reservedKey
          : undefined,
      verificationChannel: form.channel,
      discordUsername: form.discord.trim() || undefined,
      telegramUsername: form.telegram.trim() || undefined,
      signalUsername: form.signal.trim() || undefined,
    };
  }

  async function createAccount() {
    setBusy(true);
    setError(null);
    setStep("creating");
    try {
      const byodToken =
        form.didType === "web-external" && keyMode === "byod" && privateKey
          ? await createServiceJwt(
              privateKey,
              form.externalDid.trim(),
              server?.did ?? `did:web:${getSiteHostname()}`,
              "com.atproto.server.createAccount",
            )
          : undefined;
      if (mode === "password") {
        const result = await api.createAccount(
          {
            handle: fullHandle,
            email: form.email.trim(),
            password: form.password,
            ...commonParams(),
          },
          byodToken,
        );
        setAccount({ did: result.did, handle: result.handle });
        setStep("verify");
      } else {
        const result = await api.createPasskeyAccount(
          {
            handle: unsafeAsHandle(fullHandle),
            email: form.email.trim()
              ? unsafeAsEmail(form.email.trim())
              : undefined,
            ...commonParams(),
          },
          byodToken,
        );
        setAccount({
          did: result.did,
          handle: result.handle,
          setupToken: result.setupToken,
        });
        setStep("passkey");
      }
    } catch (caught) {
      setError(message(caught));
      setStep(form.didType === "web-external" ? "document" : "info");
    } finally {
      setBusy(false);
    }
  }

  async function createPasskey() {
    if (!account?.setupToken) return;
    setBusy(true);
    setError(null);
    try {
      const result = await performPasskeyRegistration(
        {
          startRegistration: () =>
            api.startPasskeyRegistrationForSetup(
              account.did,
              account.setupToken!,
              form.passkeyName.trim() || undefined,
            ),
          completeSetup: (credential, name) =>
            api.completePasskeySetup(
              account.did,
              account.setupToken!,
              credential,
              name,
            ),
        },
        form.passkeyName.trim() || undefined,
      );
      setAccount({ ...account, ...result });
      setStep("app-password");
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function finishOAuth(nextAccount: Account) {
    const requestUri = searchParams.get("request_uri");
    if (!requestUri) {
      clearRegistrationState();
      navigate("/app/settings", { replace: true });
      return;
    }
    const response = await fetch("/oauth/register/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        request_uri: requestUri,
        did: nextAccount.did,
        app_password:
          nextAccount.appPassword ??
          (mode === "password" ? form.password : undefined),
      }),
    });
    const result = (await response.json()) as {
      redirect_uri?: string;
      error_description?: string;
      error?: string;
    };
    if (!response.ok)
      throw new Error(
        result.error_description ??
          result.error ??
          "OAuth registration failed.",
      );
    clearRegistrationState();
    if (result.redirect_uri) globalThis.location.assign(result.redirect_uri);
    else navigate("/app/settings", { replace: true });
  }

  async function finishVerifiedAccount(auth: SessionState) {
    if (!account) return;
    setRegistrationSession({
      accessJwt: auth.accessJwt,
      refreshJwt: auth.refreshJwt,
    });
    if (form.didType === "web-external" && keyMode === "byod") {
      const credentials = await api.getRecommendedDidCredentials(
        auth.accessJwt,
      );
      const key =
        credentials.verificationMethods?.atproto?.replace("did:key:", "") ?? "";
      if (!server) throw new Error("The server description is not available.");
      setDocumentText(
        JSON.stringify(
          generateDidDocument(
            form.externalDid.trim(),
            key,
            account.handle,
            getPublicPdsEndpoint(server),
          ),
          null,
          2,
        ),
      );
      setStep("updated-document");
      return;
    }
    if (form.didType === "web-external")
      await api.activateAccount(auth.accessJwt);
    setSession({ ...account, ...auth });
    await finishOAuth(account);
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      const confirmed = await api.confirmSignup(
        account.did,
        verificationCode.trim(),
      );
      let auth = confirmed;
      if (form.didType === "web-external") {
        const credential =
          mode === "passkey" ? account.appPassword : form.password;
        if (!credential)
          throw new Error(
            "Enter the account password to continue this restored registration.",
          );
        auth = await api.createSession(account.did, credential);
      }
      await finishVerifiedAccount(auth);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!account || !registrationSession) return;
    setBusy(true);
    try {
      await api.activateAccount(registrationSession.accessJwt);
      setSession({ ...account, ...registrationSession });
      await finishOAuth(account);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!server)
    return (
      <AuthLayout title="Create an account">
        {error ? (
          <Alert tone="error">{error}</Alert>
        ) : (
          <Loading label="Loading server settings" />
        )}
      </AuthLayout>
    );
  return (
    <AuthLayout
      title={step === "verify" ? "Verify your account" : "Create an account"}
      description={step === "info" ? `Join ${getSiteHostname()}.` : undefined}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {step === "info" ? (
        <AccountDetailsView
          mode={mode}
          form={form}
          setForm={setForm}
          server={server}
          availableChannels={availableChannels}
          fullHandle={fullHandle}
          busy={busy}
          onSubmit={submitInfo}
          onModeChange={(nextMode) =>
            navigate(
              `/app/oauth/register${nextMode === "password" ? "-password" : ""}${
                searchParams.toString() ? `?${searchParams}` : ""
              }`,
            )
          }
        />
      ) : null}
      {step === "key" || step === "document" || step === "updated-document" ? (
        <DidSetupView
          step={step}
          documentText={documentText}
          busy={busy}
          onChooseKey={(nextKeyMode) => void prepareExternalDid(nextKeyMode)}
          onBack={() => setStep("info")}
          onContinue={() =>
            step === "document" ? void createAccount() : void activate()
          }
        />
      ) : null}
      {step === "creating" ? <Loading label="Creating account" /> : null}
      {step === "passkey" || step === "app-password" ? (
        <CredentialView
          step={step}
          form={form}
          setForm={setForm}
          account={account}
          busy={busy}
          onCreatePasskey={() => void createPasskey()}
          onCredentialSaved={() => setStep("verify")}
        />
      ) : null}
      {step === "verify" ? (
        <VerificationView
          form={form}
          setForm={setForm}
          account={account}
          server={server}
          usesBotVerification={usesBotVerification}
          restoredPasswordRequired={
            form.didType === "web-external" &&
            mode === "password" &&
            !form.password
          }
          verificationCode={verificationCode}
          busy={busy}
          onVerificationCodeChange={setVerificationCode}
          onSubmit={verify}
        />
      ) : null}
    </AuthLayout>
  );
}
