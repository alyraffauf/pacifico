import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout.tsx";
import {
  Alert,
  Button,
  Field,
  Input,
  Loading,
  Select,
} from "../../components/ui.tsx";
import {
  ensureRequestUri,
  getOAuthRequestUri,
  getRequestUriFromUrl,
} from "../../lib/oauth.ts";
import { readJson } from "../../lib/http.ts";
import { denyAuthorization } from "../../lib/pacifico/oauth-denial.ts";
import { persistSsoRegistrationSession } from "../../lib/pacifico/sso-session.ts";
import type {
  DidType,
  ServerDescription,
  VerificationChannel,
} from "../../lib/types/api.ts";

interface SsoProvider {
  provider: string;
  name: string;
}

interface PendingRegistration {
  provider: string;
  provider_username: string | null;
  provider_email: string | null;
  provider_email_verified: boolean;
}

interface RegistrationResult {
  did: string;
  handle: string;
  redirectUrl: string;
  accessJwt?: string;
  refreshJwt?: string;
  appPassword?: string;
}

export function SsoRegisterPage() {
  const requestUri = getRequestUriFromUrl();
  const passwordRegistrationUrl = requestUri
    ? `/app/oauth/register-password?request_uri=${encodeURIComponent(requestUri)}`
    : "/app/oauth/register-password";
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [initiating, setInitiating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureRequestUri()
      .then(async (ensuredRequestUri) => {
        if (!ensuredRequestUri)
          throw new Error("The registration request is missing.");
        const data = await readJson<{ providers?: SsoProvider[] }>(
          await fetch("/oauth/sso/providers"),
        );
        setProviders(
          [...(data.providers ?? [])].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        );
      })
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load sign-in providers.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  async function begin(provider: string) {
    setInitiating(provider);
    setError(null);
    try {
      let currentRequestUri = getRequestUriFromUrl();
      let response = await fetch("/oauth/sso/initiate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          provider,
          action: "register",
          request_uri: currentRequestUri,
        }),
      });
      if (!response.ok) {
        currentRequestUri = await getOAuthRequestUri("create");
        const url = new URL(globalThis.location.href);
        url.searchParams.set("request_uri", currentRequestUri);
        globalThis.location.assign(url);
        return;
      }
      const result = await readJson<{ redirect_url?: string }>(response);
      if (!result.redirect_url)
        throw new Error("The identity provider returned no redirect.");
      globalThis.location.assign(result.redirect_url);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not start SSO registration.",
      );
      setInitiating(null);
    }
  }

  async function cancel() {
    if (!requestUri) {
      globalThis.history.back();
      return;
    }
    try {
      globalThis.location.assign(await denyAuthorization(requestUri));
    } catch {
      globalThis.history.back();
    }
  }

  return (
    <AuthLayout
      title="Create an account with SSO"
      description={`Choose an identity provider for ${globalThis.location.hostname}.`}
    >
      <div className="grid gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {loading ? (
          <Loading label="Loading providers" />
        ) : providers.length ? (
          providers.map((provider) => (
            <Button
              key={provider.provider}
              variant="secondary"
              disabled={initiating !== null}
              onClick={() => void begin(provider.provider)}
            >
              {initiating === provider.provider
                ? "Opening provider"
                : `Continue with ${provider.name}`}
            </Button>
          ))
        ) : (
          <Alert tone="warning">
            This server has no SSO providers configured.
          </Alert>
        )}
        <Link className="text-center text-sm" to={passwordRegistrationUrl}>
          Use a password instead
        </Link>
        <Link className="text-center text-sm" to="/app/migrate">
          Move an existing account here
        </Link>
        <Button
          type="button"
          variant="ghost"
          disabled={initiating !== null}
          onClick={() => void cancel()}
        >
          Cancel registration
        </Button>
      </div>
    </AuthLayout>
  );
}

export function SsoRegisterCompletePage() {
  const token = new URLSearchParams(globalThis.location.search).get("token");
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [server, setServer] = useState<ServerDescription | null>(null);
  const [handle, setHandle] = useState("");
  const [domain, setDomain] = useState(globalThis.location.hostname);
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState("");
  const [channel, setChannel] = useState<VerificationChannel>("email");
  const [channelIdentifier, setChannelIdentifier] = useState("");
  const [didType, setDidType] = useState<DidType>("plc");
  const [externalDid, setExternalDid] = useState("");
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(Boolean(token));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : "This registration link is missing or expired.",
  );
  const fullHandle =
    handle.includes(".") || !domain
      ? handle.trim()
      : `${handle.trim()}.${domain}`;

  useEffect(() => {
    if (!token) {
      return;
    }
    let active = true;

    void fetch(
      `/oauth/sso/pending-registration?token=${encodeURIComponent(token)}`,
    )
      .then((response) => readJson<PendingRegistration>(response))
      .then((registration) => {
        if (!active) return;
        setPending(registration);
        setEmail(registration.provider_email ?? "");
        setHandle(
          (registration.provider_username ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, ""),
        );
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load registration.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void fetch("/xrpc/com.atproto.server.describeServer")
      .then((response) => readJson<ServerDescription>(response))
      .then((description) => {
        if (!active) return;
        setServer(description);
        setDomain(
          description.availableUserDomains[0] ?? globalThis.location.hostname,
        );
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [token]);

  function complete(resultValue: RegistrationResult) {
    persistSsoRegistrationSession(resultValue);
    if (resultValue.redirectUrl.startsWith("/app/verify")) {
      localStorage.setItem(
        "tranquil_pds_pending_verification",
        JSON.stringify({
          did: resultValue.did,
          handle: resultValue.handle,
          channel,
        }),
      );
      const verificationUrl = new URL(
        resultValue.redirectUrl,
        globalThis.location.origin,
      );
      verificationUrl.searchParams.set("handle", resultValue.handle);
      verificationUrl.searchParams.set("channel", channel);
      globalThis.location.assign(
        `${verificationUrl.pathname}${verificationUrl.search}`,
      );
      return;
    }
    globalThis.location.assign(resultValue.redirectUrl);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !pending) return;
    setSubmitting(true);
    setError(null);
    try {
      const available = await readJson<{ available: boolean; reason?: string }>(
        await fetch(
          `/oauth/sso/check-handle-available?${new URLSearchParams({ handle, domain })}`,
        ),
      );
      if (!available.available)
        throw new Error(available.reason ?? "That handle is not available.");
      const created = await readJson<RegistrationResult>(
        await fetch("/oauth/sso/complete-registration", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            token,
            handle: fullHandle,
            email: email || null,
            invite_code: invite || null,
            verification_channel: channel,
            discord_username: channel === "discord" ? channelIdentifier : null,
            telegram_username:
              channel === "telegram" ? channelIdentifier : null,
            signal_username: channel === "signal" ? channelIdentifier : null,
            did_type: didType,
            did: didType === "web-external" ? externalDid.trim() : null,
          }),
        }),
      );
      if (created.appPassword) setResult(created);
      else complete(created);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Registration failed.",
      );
      setSubmitting(false);
    }
  }

  if (loading)
    return (
      <AuthLayout title="Completing SSO registration">
        <Loading />
      </AuthLayout>
    );
  if (!pending)
    return (
      <AuthLayout title="Registration expired">
        {error ? <Alert tone="error">{error}</Alert> : null}
      </AuthLayout>
    );
  if (result?.appPassword)
    return (
      <AuthLayout
        title="Save your app password"
        description="This password is shown once. Store it before continuing."
      >
        <div className="grid gap-4">
          <Alert tone="warning">
            <span className="font-mono break-all">{result.appPassword}</span>
          </Alert>
          <label className="flex gap-3 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />{" "}
            I saved this app password.
          </label>
          <Button disabled={!acknowledged} onClick={() => complete(result)}>
            Continue
          </Button>
        </div>
      </AuthLayout>
    );
  const channels = server?.availableCommsChannels ?? ["email"];
  const usesVerifiedProviderEmail =
    pending.provider_email_verified &&
    channel === "email" &&
    email.trim().toLowerCase() === pending.provider_email?.toLowerCase();

  return (
    <AuthLayout
      title="Finish creating your account"
      description={`Authenticated with ${pending.provider}.`}
    >
      <form className="grid gap-4" onSubmit={submit}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field label="Handle">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              value={handle}
              minLength={3}
              onChange={(event) => setHandle(event.target.value)}
              required
            />
            <Select
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            >
              {(
                server?.availableUserDomains ?? [globalThis.location.hostname]
              ).map((value) => (
                <option key={value} value={value}>
                  .{value}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required={channel === "email"}
          />
          {pending.provider_email_verified && channel === "email" ? (
            <span
              className={`mt-1 block text-xs ${usesVerifiedProviderEmail ? "text-ctp-green" : "text-ctp-overlay1"}`}
            >
              {usesVerifiedProviderEmail
                ? "Verified by your identity provider."
                : "This address differs from the verified provider address and must be verified again."}
            </span>
          ) : null}
        </Field>
        <Field label="Verification channel">
          <Select
            value={channel}
            onChange={(event) =>
              setChannel(event.target.value as VerificationChannel)
            }
          >
            {channels.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        {channel !== "email" ? (
          <Field label={`${channel} username`}>
            <Input
              value={channelIdentifier}
              onChange={(event) => setChannelIdentifier(event.target.value)}
              required
            />
          </Field>
        ) : null}
        <Field label="DID type">
          <Select
            value={didType}
            onChange={(event) => setDidType(event.target.value as DidType)}
          >
            <option value="plc">did:plc</option>
            {server?.selfHostedDidWebEnabled !== false ? (
              <option value="web">Hosted did:web</option>
            ) : null}
            <option value="web-external">Existing did:web</option>
          </Select>
        </Field>
        {didType === "web-external" ? (
          <Field label="Existing DID">
            <Input
              value={externalDid}
              onChange={(event) => setExternalDid(event.target.value)}
              placeholder="did:web:example.com"
              required
            />
          </Field>
        ) : null}
        {server?.inviteCodeRequired ? (
          <Field label="Invite code">
            <Input
              value={invite}
              onChange={(event) => setInvite(event.target.value)}
              required
            />
          </Field>
        ) : null}
        <Button
          disabled={
            submitting ||
            !fullHandle ||
            (channel === "email" && !email) ||
            (channel !== "email" && !channelIdentifier) ||
            (didType === "web-external" && !externalDid.trim())
          }
        >
          {submitting ? "Creating account" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
