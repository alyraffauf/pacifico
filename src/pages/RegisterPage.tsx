import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { ChannelVerificationPrompt, hasBotVerification, useBotVerificationPolling } from "../components/ChannelVerificationPrompt.tsx";
import { Alert, Button, Card, Field, Input, Loading, Select, Textarea } from "../components/ui.tsx";
import { setSession } from "../lib/auth.ts";
import { api, ApiError } from "../lib/api.ts";
import { createServiceJwt, generateDidDocument, generateKeypair } from "../lib/crypto.ts";
import { performPasskeyRegistration } from "../lib/flows/perform-passkey-registration.ts";
import { getSiteHostname } from "../lib/site.ts";
import type { DidType, ServerDescription, VerificationChannel } from "../lib/types/api.ts";
import { unsafeAsDid, unsafeAsEmail, unsafeAsHandle } from "../lib/types/branded.ts";
import {
  clearRegistrationState,
  loadRegistrationState,
  saveRegistrationState,
} from "../lib/registration/storage.ts";
import type { RegistrationStep, SessionState } from "../lib/registration/types.ts";
import { getPublicPdsEndpoint } from "../lib/pacifico/registration.ts";

type Mode = "passkey" | "password";
type Step = "info" | "key" | "document" | "creating" | "passkey" | "app-password" | "verify" | "updated-document";
type Account = { did: ReturnType<typeof unsafeAsDid>; handle: ReturnType<typeof unsafeAsHandle>; setupToken?: string; appPassword?: string; appPasswordName?: string };

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
  if (step === "updated-did-doc" || step === "activating") return "updated-document";
  if (step === "redirect-to-dashboard") return "info";
  return step;
}

export function RegisterPage() {
  const location = useLocation(); const navigate = useNavigate(); const [searchParams] = useSearchParams();
  const mode: Mode = location.pathname.includes("register-password") ? "password" : "passkey";
  const restored = useMemo(() => {
    const saved = loadRegistrationState();
    return saved?.mode === mode ? saved : null;
  }, [mode]);
  const [server, setServer] = useState<ServerDescription | null>(null);
  const [step, setStep] = useState<Step>(() => restored ? restorePageStep(restored.step) : "info");
  const [form, setForm] = useState(() => ({ handle: restored?.info.handle ?? "", domain: restored?.pdsHostname ?? "", email: restored?.info.email ?? "", password: "", confirmPassword: "", inviteCode: restored?.info.inviteCode ?? "", didType: restored?.info.didType ?? "plc" as DidType, externalDid: restored?.info.externalDid ?? "", channel: restored?.info.verificationChannel ?? "email" as VerificationChannel, discord: restored?.info.discordUsername ?? "", telegram: restored?.info.telegramUsername ?? "", signal: restored?.info.signalUsername ?? "", passkeyName: "" }));
  const [keyMode, setKeyMode] = useState<"reserved" | "byod">(restored?.externalDidWeb.keyMode ?? "reserved");
  const [reservedKey, setReservedKey] = useState<string | undefined>(restored?.externalDidWeb.reservedSigningKey);
  const [privateKey, setPrivateKey] = useState<Uint8Array | undefined>(restored?.externalDidWeb.byodPrivateKey);
  const [documentText, setDocumentText] = useState(restored?.externalDidWeb.updatedDidDocument ?? restored?.externalDidWeb.initialDidDocument ?? "");
  const [account, setAccount] = useState<Account | null>(restored?.account ?? null);
  const [registrationSession, setRegistrationSession] = useState<SessionState | null>(restored?.session ?? null);
  const [verificationCode, setVerificationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void api.describeServer().then((result) => { setServer(result); setForm((current) => ({ ...current, domain: current.domain || result.availableUserDomains[0] || getSiteHostname() })); }).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load server settings.")); }, []);
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
        updatedDidDocument: step === "updated-document" ? documentText : undefined,
      },
      account,
      registrationSession,
    );
  }, [account, documentText, form, keyMode, mode, privateKey, registrationSession, reservedKey, server, step]);
  const fullHandle = useMemo(() => form.handle.trim() ? `${form.handle.trim()}.${form.domain}` : "", [form.handle, form.domain]);
  const availableChannels = server?.availableCommsChannels ?? ["email"];
  const usesBotVerification = hasBotVerification(form.channel);

  useBotVerificationPolling(step === "verify" && Boolean(account && server) && usesBotVerification, async () => {
    if (!account) return false;
    return (await api.checkChannelVerified(account.did, form.channel)).verified;
  }, async () => {
    if (!account) return;
    const credential = mode === "passkey" ? account.appPassword : form.password;
    if (!credential) return;
    const auth = await api.createSession(account.did, credential);
    await finishVerifiedAccount(auth);
  });

  function message(caught: unknown) { return caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "The request failed."; }
  function validate() {
    if (!form.handle.trim() || form.handle.includes(".")) return "Enter only the part of the handle before the domain.";
    if (mode === "password" && form.password.length < 8) return "Use at least eight characters for the password.";
    if (mode === "password" && form.password !== form.confirmPassword) return "The passwords do not match.";
    if (server?.inviteCodeRequired && !form.inviteCode.trim()) return "An invite code is required.";
    if (form.didType === "web-external" && !form.externalDid.trim().startsWith("did:web:")) return "Enter a valid did:web identifier.";
    const identifier = form.channel === "email" ? form.email : form[form.channel];
    if (!identifier.trim()) return `Enter the ${form.channel === "email" ? "email address" : `${form.channel} username`} used for verification.`;
    return null;
  }

  async function submitInfo(event: React.FormEvent) {
    event.preventDefault(); const problem = validate(); if (problem) { setError(problem); return; }
    if (mode === "passkey" && !globalThis.PublicKeyCredential) { setError("This browser does not support passkeys."); return; }
    setError(null);
    if (form.didType === "web-external") setStep("key"); else await createAccount();
  }

  async function prepareExternalDid(nextMode: "reserved" | "byod") {
    setBusy(true); setError(null); setKeyMode(nextMode);
    try {
      let publicKey: string;
      if (nextMode === "reserved") { const result = await api.reserveSigningKey(unsafeAsDid(form.externalDid.trim())); setReservedKey(result.signingKey); publicKey = result.signingKey.replace("did:key:", ""); }
      else { const result = generateKeypair(); setPrivateKey(result.privateKey); publicKey = result.publicKeyMultibase; }
      if (!server) throw new Error("The server description is not available.");
      const doc = generateDidDocument(form.externalDid.trim(), publicKey, fullHandle, getPublicPdsEndpoint(server));
      setDocumentText(JSON.stringify(doc, null, 2)); setStep("document");
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }

  function commonParams() { return { inviteCode: form.inviteCode.trim() || undefined, didType: form.didType, did: form.didType === "web-external" ? unsafeAsDid(form.externalDid.trim()) : undefined, signingKey: form.didType === "web-external" && keyMode === "reserved" ? reservedKey : undefined, verificationChannel: form.channel, discordUsername: form.discord.trim() || undefined, telegramUsername: form.telegram.trim() || undefined, signalUsername: form.signal.trim() || undefined }; }

  async function createAccount() {
    setBusy(true); setError(null); setStep("creating");
    try {
      const byodToken = form.didType === "web-external" && keyMode === "byod" && privateKey ? await createServiceJwt(privateKey, form.externalDid.trim(), server?.did ?? `did:web:${getSiteHostname()}`, "com.atproto.server.createAccount") : undefined;
      if (mode === "password") {
        const result = await api.createAccount({ handle: fullHandle, email: form.email.trim(), password: form.password, ...commonParams() }, byodToken);
        setAccount({ did: result.did, handle: result.handle }); setStep("verify");
      } else {
        const result = await api.createPasskeyAccount({ handle: unsafeAsHandle(fullHandle), email: form.email.trim() ? unsafeAsEmail(form.email.trim()) : undefined, ...commonParams() }, byodToken);
        setAccount({ did: result.did, handle: result.handle, setupToken: result.setupToken }); setStep("passkey");
      }
    } catch (caught) { setError(message(caught)); setStep(form.didType === "web-external" ? "document" : "info"); }
    finally { setBusy(false); }
  }

  async function createPasskey() {
    if (!account?.setupToken) return; setBusy(true); setError(null);
    try {
      const result = await performPasskeyRegistration({ startRegistration: () => api.startPasskeyRegistrationForSetup(account.did, account.setupToken!, form.passkeyName.trim() || undefined), completeSetup: (credential, name) => api.completePasskeySetup(account.did, account.setupToken!, credential, name) }, form.passkeyName.trim() || undefined);
      setAccount({ ...account, ...result }); setStep("app-password");
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }

  async function finishOAuth(nextAccount: Account) {
    const requestUri = searchParams.get("request_uri");
    if (!requestUri) { clearRegistrationState(); navigate("/app/settings", { replace: true }); return; }
    const response = await fetch("/oauth/register/complete", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ request_uri: requestUri, did: nextAccount.did, app_password: nextAccount.appPassword ?? (mode === "password" ? form.password : undefined) }) });
    const result = await response.json() as { redirect_uri?: string; error_description?: string; error?: string };
    if (!response.ok) throw new Error(result.error_description ?? result.error ?? "OAuth registration failed.");
    clearRegistrationState();
    if (result.redirect_uri) globalThis.location.assign(result.redirect_uri); else navigate("/app/settings", { replace: true });
  }

  async function finishVerifiedAccount(auth: SessionState) {
    if (!account) return;
    setRegistrationSession({ accessJwt: auth.accessJwt, refreshJwt: auth.refreshJwt });
    if (form.didType === "web-external" && keyMode === "byod") {
      const credentials = await api.getRecommendedDidCredentials(auth.accessJwt);
      const key = credentials.verificationMethods?.atproto?.replace("did:key:", "") ?? "";
      if (!server) throw new Error("The server description is not available.");
      setDocumentText(JSON.stringify(generateDidDocument(form.externalDid.trim(), key, account.handle, getPublicPdsEndpoint(server)), null, 2));
      setStep("updated-document");
      return;
    }
    if (form.didType === "web-external") await api.activateAccount(auth.accessJwt);
    setSession({ ...account, ...auth });
    await finishOAuth(account);
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault(); if (!account) return; setBusy(true); setError(null);
    try {
      const confirmed = await api.confirmSignup(account.did, verificationCode.trim());
      let auth = confirmed;
      if (form.didType === "web-external") {
        const credential = mode === "passkey" ? account.appPassword : form.password;
        if (!credential) throw new Error("Enter the account password to continue this restored registration.");
        auth = await api.createSession(account.did, credential);
      }
      await finishVerifiedAccount(auth);
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }

  async function activate() { if (!account || !registrationSession) return; setBusy(true); try { await api.activateAccount(registrationSession.accessJwt); setSession({ ...account, ...registrationSession }); await finishOAuth(account); } catch (caught) { setError(message(caught)); } finally { setBusy(false); } }

  if (!server) return <AuthLayout title="Create an account">{error ? <Alert tone="error">{error}</Alert> : <Loading label="Loading server settings" />}</AuthLayout>;
  const restoredPasswordField = form.didType === "web-external" && mode === "password" && !form.password
    ? <Field label="Account password" hint="Required after restoring an interrupted registration."><Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="current-password" required /></Field>
    : null;

  return <AuthLayout title={step === "verify" ? "Verify your account" : "Create an account"} description={step === "info" ? `Join ${getSiteHostname()}.` : undefined}>
    {error ? <Alert tone="error">{error}</Alert> : null}
    {step === "info" ? <form className="grid gap-4" onSubmit={submitInfo}>
      <div className="grid grid-cols-2 gap-2"><Button type="button" variant={mode === "passkey" ? "primary" : "secondary"} onClick={() => navigate(`/app/oauth/register${searchParams.toString() ? `?${searchParams}` : ""}`)}>Passkey</Button><Button type="button" variant={mode === "password" ? "primary" : "secondary"} onClick={() => navigate(`/app/oauth/register-password${searchParams.toString() ? `?${searchParams}` : ""}`)}>Password</Button></div>
      <div className="grid grid-cols-[1fr_minmax(9rem,auto)] gap-2"><Field label="Handle"><Input value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value })} placeholder="alice" autoComplete="username" required /></Field><Field label="Domain"><Select value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })}>{server.availableUserDomains.map((domain) => <option key={domain}>{domain}</option>)}</Select></Field></div>
      {fullHandle ? <p className="-mt-2 font-mono text-xs text-ctp-green">@{fullHandle}</p> : null}
      {mode === "password" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Password"><Input type="password" minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" required /></Field><Field label="Confirm password"><Input type="password" minLength={8} value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} autoComplete="new-password" required /></Field></div> : null}
      <Field label="Verification channel"><Select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value as VerificationChannel })}>{availableChannels.map((channel) => <option key={channel}>{channel}</option>)}</Select></Field>
      {form.channel === "email" ? <Field label="Email"><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" required /></Field> : <Field label={`${form.channel} username`}><Input value={form[form.channel]} onChange={(event) => setForm({ ...form, [form.channel]: event.target.value })} required /></Field>}
      <Field label="DID type"><Select value={form.didType} onChange={(event) => setForm({ ...form, didType: event.target.value as DidType })}><option value="plc">did:plc</option>{server.selfHostedDidWebEnabled !== false ? <option value="web">Hosted did:web</option> : null}<option value="web-external">Existing did:web</option></Select></Field>
      {form.didType === "web-external" ? <Field label="Existing DID"><Input value={form.externalDid} onChange={(event) => setForm({ ...form, externalDid: event.target.value })} placeholder="did:web:example.com" required /></Field> : null}
      {server.inviteCodeRequired ? <Field label="Invite code"><Input value={form.inviteCode} onChange={(event) => setForm({ ...form, inviteCode: event.target.value })} required /></Field> : null}
      <Button disabled={busy}>{busy ? "Creating" : "Create account"}</Button><Link className="text-center text-sm" to="/app/migrate">Move an existing account</Link><Link className="text-center text-sm" to="/app/login">Sign in instead</Link>
    </form> : null}
    {step === "key" ? <div className="grid gap-4"><p className="text-sm leading-6 text-ctp-subtext-0">Choose who creates the first signing key for your existing DID.</p><Button disabled={busy} onClick={() => void prepareExternalDid("reserved")}>Use a server-reserved key</Button><Button variant="secondary" disabled={busy} onClick={() => void prepareExternalDid("byod")}>Generate a key in this browser</Button><Button variant="ghost" onClick={() => setStep("info")}>Back</Button></div> : null}
    {step === "document" || step === "updated-document" ? <div className="grid gap-4"><Alert tone="warning">Publish this document at your did:web address before continuing.</Alert><Field label="DID document"><Textarea className="min-h-80 bg-ctp-crust" value={documentText} readOnly spellCheck={false} /></Field><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(documentText)}>Copy document</Button><Button disabled={busy} onClick={() => step === "document" ? void createAccount() : void activate()}>{busy ? "Checking" : "I published it"}</Button></div> : null}
    {step === "creating" ? <Loading label="Creating account" /> : null}
    {step === "passkey" ? <div className="grid gap-4"><p className="text-sm leading-6 text-ctp-subtext-0">Create the passkey you will use to sign in.</p><Field label="Passkey name" hint="Optional"><Input value={form.passkeyName} onChange={(event) => setForm({ ...form, passkeyName: event.target.value })} placeholder="This device" /></Field><Button disabled={busy} onClick={() => void createPasskey()}>{busy ? "Waiting for browser" : "Create passkey"}</Button></div> : null}
    {step === "app-password" && account ? <div className="grid gap-4"><Alert tone="warning">Save this recovery credential now. It will not be shown again.</Alert><Card className="p-4"><p className="text-xs text-ctp-overlay-1">{account.appPasswordName}</p><code className="mt-2 block break-all font-mono text-ctp-green">{account.appPassword}</code></Card><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(account.appPassword ?? "")}>Copy credential</Button><Button onClick={() => setStep("verify")}>I saved it</Button></div> : null}
    {step === "verify" ? usesBotVerification && account
      ? <div className="grid gap-4"><ChannelVerificationPrompt channel={form.channel} handle={account.handle} server={server} />{restoredPasswordField}</div>
      : <form className="grid gap-4" onSubmit={verify}><p className="text-sm leading-6 text-ctp-subtext-0">Enter the code sent through {form.channel}.</p><Field label="Verification code"><Input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required /></Field>{restoredPasswordField}<Button disabled={busy || !verificationCode.trim()}>{busy ? "Verifying" : "Verify"}</Button></form> : null}
  </AuthLayout>;
}
