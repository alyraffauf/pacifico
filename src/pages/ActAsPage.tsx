import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Alert, Loading } from "../components/ui.tsx";
import { useAuthState } from "../hooks/useAuthState.ts";
import { api } from "../lib/api.ts";
import { createAuthenticatedClient } from "../lib/authenticated-client.ts";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  saveOAuthState,
  SCOPES,
} from "../lib/oauth.ts";
import { unsafeAsDid } from "../lib/types/branded.ts";

export function ActAsPage() {
  const auth = useAuthState();
  const [params] = useSearchParams();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.kind !== "authenticated" || started.current) return;
    started.current = true;
    const session = auth.session;
    const delegatedDid = params.get("did");

    void (async () => {
      if (!delegatedDid) throw new Error("No delegated account was specified.");
      const accountsResult =
        await createAuthenticatedClient(
          session,
        ).listDelegationControlledAccounts();
      if (!accountsResult.ok) throw accountsResult.error;
      const account = accountsResult.value.accounts.find(
        (candidate) => candidate.did === delegatedDid,
      );
      if (!account)
        throw new Error("You do not have access to that delegated account.");

      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      saveOAuthState({ state, codeVerifier });
      const parResponse = await fetch("/oauth/par", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: `${globalThis.location.origin}/oauth-client-metadata.json`,
          redirect_uri: `${globalThis.location.origin}/app/`,
          response_type: "code",
          scope: SCOPES,
          state,
          code_challenge: await generateCodeChallenge(codeVerifier),
          code_challenge_method: "S256",
          login_hint: account.handle ?? account.did,
        }),
      });
      if (!parResponse.ok)
        throw new Error("The delegated sign-in request was rejected.");
      const par = (await parResponse.json()) as { request_uri?: string };
      if (!par.request_uri)
        throw new Error("The server returned an invalid sign-in request.");

      const result = await api.authorizeDelegatedSession(
        session.accessJwt,
        par.request_uri,
        unsafeAsDid(delegatedDid),
      );
      globalThis.location.assign(result.redirect_uri);
    })().catch((caught) =>
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not start delegated sign-in.",
      ),
    );
  }, [auth, params]);

  if (auth.kind === "loading")
    return (
      <AuthLayout title="Preparing delegated sign-in">
        <Loading />
      </AuthLayout>
    );
  if (auth.kind !== "authenticated")
    return <Navigate to="/app/login" replace />;
  return (
    <AuthLayout
      title="Preparing delegated sign-in"
      description="Checking access and opening the selected account."
    >
      {error ? (
        <>
          <Alert tone="error">{error}</Alert>
          <Link
            className="mt-5 block text-center text-sm"
            to="/app/controllers"
          >
            Back to delegation
          </Link>
        </>
      ) : (
        <Loading label="Preparing account" />
      )}
    </AuthLayout>
  );
}
