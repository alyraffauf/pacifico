import { IconKey, IconLogin2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout.tsx";
import { Alert, Button, Field, Input } from "../../components/ui.tsx";
import { readJson, requestParameter } from "../../lib/http.ts";
import {
  getAuthorizationDestination,
  type AuthorizationResult,
} from "../../lib/pacifico/oauth-flow.ts";
import {
  prepareRequestOptions,
  serializeAssertionResponse,
  type WebAuthnRequestOptionsResponse,
} from "../../lib/webauthn.ts";

type Provider = { provider: string; name: string; icon: string };
type AuthorizationResponse = AuthorizationResult & {
  error?: string;
  error_description?: string;
  did?: string;
  handle?: string;
  options?: unknown;
};

const pendingVerificationStorageKey = "tranquil_pds_pending_verification";

export function OAuthLoginPage() {
  const navigate = useNavigate();
  const requestUri = requestParameter("request_uri");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [clientName, setClientName] = useState<string | null>(null);
  const initialError = requestParameter("error");
  const [error, setError] = useState<string | null>(
    initialError === "account_not_verified" ? null : initialError,
  );
  const [verificationResent, setVerificationResent] = useState(
    initialError === "account_not_verified",
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!requestUri) return;
    void fetch(
      `/oauth/authorize?request_uri=${encodeURIComponent(requestUri)}`,
      { headers: { Accept: "application/json" } },
    )
      .then((response) =>
        readJson<{ login_hint?: string; client_name?: string }>(response),
      )
      .then((data) => {
        if (data.login_hint) setUsername(data.login_hint);
        if (data.client_name) setClientName(data.client_name);
      })
      .catch(() => undefined);
    void fetch("/oauth/sso/providers")
      .then((response) => readJson<{ providers?: Provider[] }>(response))
      .then((data) =>
        setProviders(
          [...(data.providers ?? [])].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        ),
      )
      .catch(() => setProviders([]));
  }, [requestUri]);

  useEffect(() => {
    const identifier = username.trim();
    if (!requestUri || identifier.length < 3) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetch(
        `/oauth/security-status?identifier=${encodeURIComponent(identifier)}`,
        {
          signal: controller.signal,
        },
      )
        .then((response) =>
          readJson<{ isDelegated?: boolean; did?: string }>(response),
        )
        .then((status) => {
          if (!status.isDelegated || !status.did) return;
          navigate(
            `/app/oauth/delegation?request_uri=${encodeURIComponent(requestUri)}&delegated_did=${encodeURIComponent(status.did)}`,
          );
        })
        .catch(() => undefined);
    }, 500);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [navigate, requestUri, username]);

  function storePendingVerification(result: AuthorizationResponse) {
    if (!result.did) return;
    localStorage.setItem(
      pendingVerificationStorageKey,
      JSON.stringify({
        did: result.did,
        handle: result.handle ?? username.trim(),
        channel: result.channel ?? "",
      }),
    );
  }

  async function readAuthorizationResponse(
    response: Response,
  ): Promise<AuthorizationResponse | null> {
    const result = (await response
      .json()
      .catch(() => ({}))) as AuthorizationResponse;
    if (response.ok) return result;

    if (result.error === "account_not_verified") {
      storePendingVerification(result);
      setVerificationResent(true);
      setSubmitting(false);
      return null;
    }

    throw new Error(
      result.error_description ||
        result.error ||
        `Request failed with ${response.status}`,
    );
  }

  function finishAuthorization(result: AuthorizationResult) {
    if (!requestUri) return;
    const destination = getAuthorizationDestination(result, requestUri);
    if (!destination)
      throw new Error("The authorization server returned no next step.");

    if (destination.startsWith("/app/")) navigate(destination);
    else window.location.assign(destination);
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!requestUri) return setError("The authorization request is missing.");
    setSubmitting(true);
    setError(null);
    setVerificationResent(false);
    try {
      const response = await fetch("/oauth/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          request_uri: requestUri,
          username,
          password,
          remember_device: rememberDevice,
        }),
      });
      const result = await readAuthorizationResponse(response);
      if (result) finishAuthorization(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
      setSubmitting(false);
    }
  }

  async function submitPasskey() {
    if (!requestUri) return setError("The authorization request is missing.");
    setSubmitting(true);
    setError(null);
    setVerificationResent(false);
    try {
      const startResponse = await fetch("/oauth/passkey/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          request_uri: requestUri,
          ...(username.trim() ? { identifier: username.trim() } : {}),
        }),
      });
      const start = await readAuthorizationResponse(startResponse);
      if (!start) return;
      const credential = (await navigator.credentials.get({
        publicKey: prepareRequestOptions(
          start.options as WebAuthnRequestOptionsResponse,
        ),
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error("Passkey sign-in was cancelled.");
      const finishResponse = await fetch("/oauth/passkey/finish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          request_uri: requestUri,
          credential: serializeAssertionResponse(credential),
        }),
      });
      const result = await readAuthorizationResponse(finishResponse);
      if (result) finishAuthorization(result);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Passkey sign-in failed.",
      );
      setSubmitting(false);
    }
  }

  async function submitSso(provider: string) {
    if (!requestUri) return setError("The authorization request is missing.");
    setSubmitting(true);
    try {
      const result = await readJson<{ redirect_url?: string }>(
        await fetch("/oauth/sso/initiate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            provider,
            request_uri: requestUri,
            action: "login",
          }),
        }),
      );
      if (!result.redirect_url)
        throw new Error("The identity provider returned no redirect.");
      window.location.assign(result.redirect_url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "SSO sign-in failed.",
      );
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Authorize access"
      description={
        clientName ? (
          <>
            Sign in to continue to{" "}
            <strong className="text-ctp-text">{clientName}</strong>.
          </>
        ) : (
          "Sign in to continue to the requesting application."
        )
      }
    >
      <form className="grid gap-4" onSubmit={submitPassword}>
        {verificationResent ? (
          <Alert tone="warning">
            A new verification code was sent.{" "}
            <a
              href={`/app/verify?request_uri=${encodeURIComponent(requestUri ?? "")}`}
            >
              Verify your account
            </a>
            .
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field label="Handle or email">
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </Field>
        {providers.length > 0 ? (
          <div className="grid gap-2">
            {providers.map((provider) => (
              <Button
                key={provider.provider}
                type="button"
                variant="secondary"
                onClick={() => void submitSso(provider.provider)}
                disabled={submitting}
              >
                Continue with {provider.name}
              </Button>
            ))}
          </div>
        ) : null}
        {globalThis.PublicKeyCredential ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void submitPasskey()}
            disabled={submitting}
          >
            <IconKey className="size-4" /> Use a passkey
          </Button>
        ) : null}
        <div className="flex items-center gap-3 py-1 text-xs text-ctp-overlay-1 before:h-px before:flex-1 before:bg-ctp-surface-0 after:h-px after:flex-1 after:bg-ctp-surface-0">
          or use a password
        </div>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ctp-subtext-0">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(event) => setRememberDevice(event.target.checked)}
            className="accent-ctp-lavender"
          />{" "}
          Trust this device
        </label>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => window.location.assign("/")}
          >
            Cancel
          </Button>
          <Button disabled={submitting || !username || !password}>
            <IconLogin2 className="size-4" />
            {submitting ? "Signing in" : "Sign in"}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
