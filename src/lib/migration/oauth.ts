import type { OAuthServerMetadata, OAuthTokenResponse } from "./types.ts";
import { createDPoPProof, type DPoPKeyPair } from "./dpop.ts";

export async function getOAuthServerMetadata(
  pdsUrl: string,
): Promise<OAuthServerMetadata | null> {
  try {
    const directUrl = `${pdsUrl}/.well-known/oauth-authorization-server`;
    const directRes = await fetch(directUrl);
    if (directRes.ok) {
      return directRes.json();
    }

    const protectedResourceUrl = `${pdsUrl}/.well-known/oauth-protected-resource`;
    const protectedRes = await fetch(protectedResourceUrl);
    if (!protectedRes.ok) {
      return null;
    }

    const protectedMetadata = await protectedRes.json();
    const authServers = protectedMetadata.authorization_servers;
    if (!authServers || authServers.length === 0) {
      return null;
    }

    const authServerUrl = `${
      authServers[0]
    }/.well-known/oauth-authorization-server`;
    const authServerRes = await fetch(authServerUrl);
    if (!authServerRes.ok) {
      return null;
    }

    return authServerRes.json();
  } catch {
    return null;
  }
}

export function buildOAuthAuthorizationUrl(
  metadata: OAuthServerMetadata,
  params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scope?: string;
    dpopJkt?: string;
    loginHint?: string;
  },
): string {
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("scope", params.scope ?? "atproto");
  if (params.dpopJkt) {
    url.searchParams.set("dpop_jkt", params.dpopJkt);
  }
  if (params.loginHint) {
    url.searchParams.set("login_hint", params.loginHint);
  }
  return url.toString();
}

export async function initiateOAuthWithPAR(
  metadata: OAuthServerMetadata,
  params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scope?: string;
    dpopJkt?: string;
    loginHint?: string;
  },
): Promise<string> {
  if (!metadata.pushed_authorization_request_endpoint) {
    return buildOAuthAuthorizationUrl(metadata, params);
  }

  const body = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    state: params.state,
    scope: params.scope ?? "atproto",
  });

  if (params.dpopJkt) {
    body.set("dpop_jkt", params.dpopJkt);
  }
  if (params.loginHint) {
    body.set("login_hint", params.loginHint);
  }

  const res = await fetch(metadata.pushed_authorization_request_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({
      error: "par_error",
      error_description: res.statusText,
    }));
    throw new Error(err.error_description || err.error || "PAR request failed");
  }

  const { request_uri } = await res.json();

  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set("client_id", params.clientId);
  authUrl.searchParams.set("request_uri", request_uri);
  return authUrl.toString();
}

export async function exchangeOAuthCode(
  metadata: OAuthServerMetadata,
  params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
    dpopKeyPair?: DPoPKeyPair;
  },
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
  });

  const makeRequest = async (nonce?: string): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (params.dpopKeyPair) {
      const dpopProof = await createDPoPProof(
        params.dpopKeyPair,
        "POST",
        metadata.token_endpoint,
        nonce,
      );
      headers["DPoP"] = dpopProof;
    }

    return fetch(metadata.token_endpoint, {
      method: "POST",
      headers,
      body: body.toString(),
    });
  };

  let res = await makeRequest();

  if (!res.ok) {
    const err = await res.json().catch(() => ({
      error: "token_error",
      error_description: res.statusText,
    }));

    if (err.error === "use_dpop_nonce" && params.dpopKeyPair) {
      const dpopNonce = res.headers.get("DPoP-Nonce");
      if (dpopNonce) {
        res = await makeRequest(dpopNonce);
        if (!res.ok) {
          const retryErr = await res.json().catch(() => ({
            error: "token_error",
            error_description: res.statusText,
          }));
          throw new Error(
            retryErr.error_description ||
              retryErr.error ||
              "Token exchange failed",
          );
        }
        return res.json();
      }
    }

    throw new Error(
      err.error_description || err.error || "Token exchange failed",
    );
  }

  return res.json();
}

export async function refreshSourceOAuthToken(
  tokenEndpoint: string,
  params: {
    refreshToken: string;
    clientId: string;
    dpopKeyPair: DPoPKeyPair;
    nonce?: string;
  },
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });

  const makeRequest = async (nonce?: string): Promise<Response> => {
    const dpopProof = await createDPoPProof(
      params.dpopKeyPair,
      "POST",
      tokenEndpoint,
      nonce,
    );

    return fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: dpopProof,
      },
      body: body.toString(),
    });
  };

  let res = await makeRequest(params.nonce);

  if (!res.ok) {
    const err = await res.json().catch(() => ({
      error: "token_error",
      error_description: res.statusText,
    }));

    if (err.error === "use_dpop_nonce") {
      const dpopNonce = res.headers.get("DPoP-Nonce");
      if (dpopNonce) {
        res = await makeRequest(dpopNonce);
        if (!res.ok) {
          const retryErr = await res.json().catch(() => ({
            error: "token_error",
            error_description: res.statusText,
          }));
          throw new Error(
            retryErr.error_description ||
              retryErr.error ||
              "Token refresh failed",
          );
        }
        return res.json();
      }
    }

    throw new Error(
      err.error_description || err.error || "Token refresh failed",
    );
  }

  return res.json();
}

export function getMigrationOAuthClientId(): string {
  return `${globalThis.location.origin}/oauth-client-metadata.json`;
}

export function getMigrationOAuthRedirectUri(): string {
  return `${globalThis.location.origin}/app/migrate`;
}
