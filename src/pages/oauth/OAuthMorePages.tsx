import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout.tsx";
import { Alert, Button, Field, Input, Loading } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { readJson, requestParameter } from "../../lib/http.ts";
import {
  prepareRequestOptions,
  serializeAssertionResponse,
  type WebAuthnRequestOptionsResponse,
} from "../../lib/webauthn.ts";

type Account = { did: string; handle: string; email: string };

export function OAuthAccountsPage() {
  const navigate = useNavigate();
  const requestUri = requestParameter("request_uri");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(Boolean(requestUri));
  const [error, setError] = useState<string | null>(
    requestUri ? null : "The authorization request is missing.",
  );
  useEffect(() => {
    if (!requestUri) return;
    void fetch(
      `/oauth/authorize/accounts?request_uri=${encodeURIComponent(requestUri)}`,
    )
      .then((response) => readJson<{ accounts?: Account[] }>(response))
      .then((data) => setAccounts(data.accounts ?? []))
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "Could not load accounts.",
        ),
      )
      .finally(() => setLoading(false));
  }, [requestUri]);
  async function select(did: string) {
    if (!requestUri) return;
    try {
      const result = await readJson<{
        redirect_uri?: string;
        needs_totp?: boolean;
        needs_2fa?: boolean;
        channel?: string;
      }>(
        await fetch("/oauth/authorize/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_uri: requestUri, did }),
        }),
      );
      const encoded = encodeURIComponent(requestUri);
      if (result.needs_totp) navigate(`/app/oauth/totp?request_uri=${encoded}`);
      else if (result.needs_2fa)
        navigate(
          `/app/oauth/2fa?request_uri=${encoded}&channel=${encodeURIComponent(result.channel || "email")}`,
        );
      else if (result.redirect_uri) window.location.assign(result.redirect_uri);
      else throw new Error("The authorization server returned no next step.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not select the account.",
      );
    }
  }
  return (
    <AuthLayout
      title="Choose an account"
      description="Select the account to use for this authorization request."
    >
      {loading ? (
        <Loading />
      ) : (
        <div className="grid gap-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {accounts.map((account) => (
            <button
              key={account.did}
              type="button"
              className="rounded border border-ctp-surface1 bg-ctp-crust p-4 text-left hover:border-ctp-lavender"
              onClick={() => void select(account.did)}
            >
              <span className="block font-mono text-sm font-semibold text-ctp-text">
                @{account.handle}
              </span>
              <span className="mt-1 block text-xs text-ctp-overlay1">
                {account.email}
              </span>
            </button>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              navigate(
                requestUri
                  ? `/app/oauth/login?request_uri=${encodeURIComponent(requestUri)}`
                  : "/app/oauth/login",
              )
            }
          >
            Use another account
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}

export function OAuthErrorPage() {
  const navigate = useNavigate();
  const error = requestParameter("error") || "unknown_error";
  const description = requestParameter("error_description");
  const requestUri = requestParameter("request_uri");
  return (
    <AuthLayout
      title="Authorization failed"
      description="The application could not be authorized."
    >
      <div className="grid gap-4">
        <Alert tone="error">
          <code className="font-mono">{error}</code>
          {description ? (
            <p className="mt-2 text-ctp-red">{description}</p>
          ) : null}
        </Alert>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => window.history.back()}>
            Go back
          </Button>
          <Button
            onClick={() =>
              navigate(
                requestUri
                  ? `/app/oauth/login?request_uri=${encodeURIComponent(requestUri)}`
                  : "/app/login",
              )
            }
          >
            Sign in
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}

export function OAuthPasskeyPage() {
  const navigate = useNavigate();
  const requestUri = requestParameter("request_uri");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function authenticate() {
    if (!requestUri) return setError("The authorization request is missing.");
    setLoading(true);
    setError(null);
    try {
      const start = await readJson<{ options: unknown }>(
        await fetch(
          `/oauth/authorize/passkey?request_uri=${encodeURIComponent(requestUri)}`,
          { headers: { Accept: "application/json" } },
        ),
      );
      const credential = (await navigator.credentials.get({
        publicKey: prepareRequestOptions(
          start.options as WebAuthnRequestOptionsResponse,
        ),
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error("Passkey authentication was cancelled.");
      const finish = await readJson<{ redirect_uri?: string }>(
        await fetch("/oauth/authorize/passkey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request_uri: requestUri,
            credential: serializeAssertionResponse(credential),
          }),
        }),
      );
      if (!finish.redirect_uri)
        throw new Error("The authorization server returned no redirect.");
      window.location.assign(finish.redirect_uri);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Passkey authentication failed.",
      );
      setLoading(false);
    }
  }
  return (
    <AuthLayout
      title="Use your passkey"
      description="Your browser will ask you to choose a passkey for this account."
    >
      <div className="grid gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button onClick={() => void authenticate()} disabled={loading}>
          {loading ? "Waiting for your passkey" : "Continue with passkey"}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            navigate(
              requestUri
                ? `/app/oauth/login?request_uri=${encodeURIComponent(requestUri)}`
                : "/app/login",
            )
          }
        >
          Cancel
        </Button>
      </div>
    </AuthLayout>
  );
}

export function OAuthDelegationPage() {
  const requestUri = requestParameter("request_uri");
  const delegatedDid = requestParameter("delegated_did");
  const [controller, setController] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!requestUri || !delegatedDid)
      return setError("Delegation information is missing.");
    setSubmitting(true);
    setError(null);
    try {
      let controllerDid = controller.trim().replace(/^@/, "");
      if (!controllerDid.startsWith("did:")) {
        const resolved = await api.resolveHandle(controllerDid);
        controllerDid = resolved.did;
      }
      const result = await readJson<{ redirect_uri?: string }>(
        await fetch("/oauth/delegation/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request_uri: requestUri,
            delegated_did: delegatedDid,
            controller_did: controllerDid,
            auth_method: "cross_pds",
          }),
        }),
      );
      if (!result.redirect_uri)
        throw new Error("The delegation server returned no redirect.");
      window.location.assign(result.redirect_uri);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Delegation authorization failed.",
      );
      setSubmitting(false);
    }
  }
  return (
    <AuthLayout
      title="Authorize a delegated account"
      description={`Enter the controller for ${delegatedDid || "this account"}.`}
    >
      <form className="grid gap-4" onSubmit={submit}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field label="Controller handle or DID">
          <Input
            value={controller}
            onChange={(event) => setController(event.target.value)}
            placeholder="@controller.example.com"
            required
          />
        </Field>
        <Button disabled={submitting || !controller.trim()}>
          {submitting ? "Checking controller" : "Continue"}
        </Button>
      </form>
    </AuthLayout>
  );
}
