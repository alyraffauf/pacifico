import type {
  AccountStatus,
  BlobRef,
  CompletePasskeySetupResponse,
  CreateAccountParams,
  CreatePasskeyAccountParams,
  DidCredentials,
  DidDocument,
  OAuthServerMetadata,
  OAuthTokenResponse,
  PasskeyAccountSetup,
  PlcOperation,
  Preferences,
  ServerDescription,
  Session,
  StartPasskeyRegistrationResponse,
} from "./types.ts";

function apiLog(
  method: string,
  endpoint: string,
  data?: Record<string, unknown>,
) {
  const timestamp = new Date().toISOString();
  const msg = `[API ${timestamp}] ${method} ${endpoint}`;
  if (data) {
    console.log(msg, JSON.stringify(data, null, 2));
  } else {
    console.log(msg);
  }
}

export class AtprotoClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private dpopKeyPair: DPoPKeyPair | null = null;
  private dpopNonce: string | null = null;
  private isRefreshing = false;
  private oauthTokenEndpoint: string | null = null;
  private oauthClientId: string | null = null;

  constructor(pdsUrl: string) {
    this.baseUrl = pdsUrl.replace(/\/$/, "");
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  setRefreshToken(token: string | null) {
    this.refreshToken = token;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setDPoPKeyPair(keyPair: DPoPKeyPair | null) {
    this.dpopKeyPair = keyPair;
  }

  setOAuthRefreshContext(tokenEndpoint: string, clientId: string) {
    this.oauthTokenEndpoint = tokenEndpoint;
    this.oauthClientId = clientId;
  }

  private async tryRefreshToken(): Promise<boolean> {
    if (!this.refreshToken || this.isRefreshing) return false;
    this.isRefreshing = true;
    try {
      if (this.dpopKeyPair && this.oauthTokenEndpoint && this.oauthClientId) {
        const tokens = await refreshSourceOAuthToken(this.oauthTokenEndpoint, {
          refreshToken: this.refreshToken,
          clientId: this.oauthClientId,
          dpopKeyPair: this.dpopKeyPair,
          nonce: this.dpopNonce ?? undefined,
        });
        this.accessToken = tokens.access_token;
        this.refreshToken = tokens.refresh_token ?? this.refreshToken;
        return true;
      }
      const session = await this.refreshSessionInternal(this.refreshToken);
      this.accessToken = session.accessJwt;
      this.refreshToken = session.refreshJwt;
      return true;
    } catch {
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  private async refreshSessionInternal(refreshJwt: string): Promise<Session> {
    const url = `${this.baseUrl}/xrpc/com.atproto.server.refreshSession`;
    const headers: Record<string, string> = {};

    if (this.dpopKeyPair) {
      headers["Authorization"] = `DPoP ${refreshJwt}`;
      const tokenHash = await computeAccessTokenHash(refreshJwt);
      const dpopProof = await createDPoPProof(
        this.dpopKeyPair,
        "POST",
        url,
        this.dpopNonce ?? undefined,
        tokenHash,
      );
      headers["DPoP"] = dpopProof;
    } else {
      headers["Authorization"] = `Bearer ${refreshJwt}`;
    }

    let res = await fetch(url, { method: "POST", headers });

    if (!res.ok && this.dpopKeyPair) {
      const dpopNonce = res.headers.get("DPoP-Nonce");
      if (dpopNonce && dpopNonce !== this.dpopNonce) {
        this.dpopNonce = dpopNonce;
        headers["DPoP"] = await createDPoPProof(
          this.dpopKeyPair,
          "POST",
          url,
          dpopNonce,
          await computeAccessTokenHash(refreshJwt),
        );
        res = await fetch(url, { method: "POST", headers });
      }
    }

    if (!res.ok) {
      throw new Error("Token refresh failed");
    }

    const newNonce = res.headers.get("DPoP-Nonce");
    if (newNonce) {
      this.dpopNonce = newNonce;
    }

    return res.json();
  }

  private async xrpc<T>(
    method: string,
    options?: {
      httpMethod?: "GET" | "POST";
      params?: Record<string, string>;
      body?: unknown;
      authToken?: string;
      rawBody?: Uint8Array | Blob;
      contentType?: string;
    },
  ): Promise<T> {
    const {
      httpMethod = "GET",
      params,
      body,
      authToken,
      rawBody,
      contentType,
    } = options ?? {};

    let url = `${this.baseUrl}/xrpc/${method}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams}`;
    }

    const makeRequest = async (nonce?: string): Promise<Response> => {
      const headers: Record<string, string> = {};
      const token = authToken ?? this.accessToken;
      if (token) {
        if (this.dpopKeyPair) {
          headers["Authorization"] = `DPoP ${token}`;
          const tokenHash = await computeAccessTokenHash(token);
          const dpopProof = await createDPoPProof(
            this.dpopKeyPair,
            httpMethod,
            url.split("?")[0],
            nonce,
            tokenHash,
          );
          headers["DPoP"] = dpopProof;
        } else {
          headers["Authorization"] = `Bearer ${token}`;
        }
      }

      let requestBody: BodyInit | undefined;
      if (rawBody) {
        headers["Content-Type"] = contentType ?? "application/octet-stream";
        requestBody = rawBody as BodyInit;
      } else if (body) {
        headers["Content-Type"] = "application/json";
        requestBody = JSON.stringify(body);
      } else if (httpMethod === "POST") {
        headers["Content-Type"] = "application/json";
      }

      return fetch(url, {
        method: httpMethod,
        headers,
        body: requestBody,
      });
    };

    let res = await makeRequest(this.dpopNonce ?? undefined);

    if (!res.ok && this.dpopKeyPair) {
      const dpopNonce = res.headers.get("DPoP-Nonce");
      if (dpopNonce && dpopNonce !== this.dpopNonce) {
        this.dpopNonce = dpopNonce;
        res = await makeRequest(dpopNonce);
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));

      const isTokenExpired = (res.status === 401 || res.status === 400) &&
        (err.error === "ExpiredToken" || err.error === "invalid_token" ||
          (err.message && err.message.includes("expired")));

      if (isTokenExpired && !authToken && await this.tryRefreshToken()) {
        const retryNonce = res.headers.get("DPoP-Nonce") ?? this.dpopNonce;
        if (retryNonce) this.dpopNonce = retryNonce;
        res = await makeRequest(this.dpopNonce ?? undefined);

        if (!res.ok && this.dpopKeyPair) {
          const dpopNonce = res.headers.get("DPoP-Nonce");
          if (dpopNonce && dpopNonce !== this.dpopNonce) {
            this.dpopNonce = dpopNonce;
            res = await makeRequest(dpopNonce);
          }
        }

        if (res.ok) {
          const newNonce = res.headers.get("DPoP-Nonce");
          if (newNonce) this.dpopNonce = newNonce;
          const responseContentType = res.headers.get("content-type") ?? "";
          if (responseContentType.includes("application/json")) {
            return res.json();
          }
          return res.arrayBuffer().then((buf) => new Uint8Array(buf)) as T;
        }

        const retryErr = await res.json().catch(() => ({
          error: "Unknown",
          message: res.statusText,
        }));
        const retryError = new Error(
          retryErr.message || retryErr.error || res.statusText,
        ) as
          & Error
          & { status: number; error: string };
        retryError.status = res.status;
        retryError.error = retryErr.error;
        throw retryError;
      }

      const error = new Error(err.message || err.error || res.statusText) as
        & Error
        & {
          status: number;
          error: string;
        };
      error.status = res.status;
      error.error = err.error;
      throw error;
    }

    const newNonce = res.headers.get("DPoP-Nonce");
    if (newNonce) {
      this.dpopNonce = newNonce;
    }

    const responseContentType = res.headers.get("content-type") ?? "";
    if (responseContentType.includes("application/json")) {
      return res.json();
    }
    return res.arrayBuffer().then((buf) => new Uint8Array(buf)) as T;
  }

  async login(
    identifier: string,
    password: string,
    authFactorToken?: string,
  ): Promise<Session> {
    const body: Record<string, string> = { identifier, password };
    if (authFactorToken) {
      body.authFactorToken = authFactorToken;
    }

    const session = await this.xrpc<Session>(
      "com.atproto.server.createSession",
      {
        httpMethod: "POST",
        body,
      },
    );

    this.accessToken = session.accessJwt;
    this.refreshToken = session.refreshJwt;
    return session;
  }

  async refreshSession(refreshJwt: string): Promise<Session> {
    const session = await this.xrpc<Session>(
      "com.atproto.server.refreshSession",
      {
        httpMethod: "POST",
        authToken: refreshJwt,
      },
    );
    this.accessToken = session.accessJwt;
    return session;
  }

  describeServer(): Promise<ServerDescription> {
    return this.xrpc<ServerDescription>("com.atproto.server.describeServer");
  }

  getServiceAuth(
    aud: string,
    lxm?: string,
  ): Promise<{ token: string }> {
    const params: Record<string, string> = { aud };
    if (lxm) {
      params.lxm = lxm;
    }
    return this.xrpc("com.atproto.server.getServiceAuth", { params });
  }

  getRepo(did: string): Promise<Uint8Array> {
    return this.xrpc("com.atproto.sync.getRepo", {
      params: { did },
    });
  }

  async listBlobs(
    did: string,
    cursor?: string,
    limit = 100,
  ): Promise<{ cids: string[]; cursor?: string }> {
    const params: Record<string, string> = { did, limit: String(limit) };
    if (cursor) {
      params.cursor = cursor;
    }
    return this.xrpc("com.atproto.sync.listBlobs", { params });
  }

  async getBlob(did: string, cid: string): Promise<Uint8Array> {
    return this.xrpc("com.atproto.sync.getBlob", {
      params: { did, cid },
    });
  }

  async getBlobWithContentType(
    did: string,
    cid: string,
  ): Promise<{ data: Uint8Array; contentType: string }> {
    const url = `${this.baseUrl}/xrpc/com.atproto.sync.getBlob?did=${
      encodeURIComponent(did)
    }&cid=${encodeURIComponent(cid)}`;
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      if (this.dpopKeyPair) {
        headers["Authorization"] = `DPoP ${this.accessToken}`;
        const tokenHash = await computeAccessTokenHash(this.accessToken);
        const dpopProof = await createDPoPProof(
          this.dpopKeyPair,
          "GET",
          url.split("?")[0],
          this.dpopNonce ?? undefined,
          tokenHash,
        );
        headers["DPoP"] = dpopProof;
      } else {
        headers["Authorization"] = `Bearer ${this.accessToken}`;
      }
    }
    const res = await fetch(url, { headers });
    const newNonce = res.headers.get("DPoP-Nonce");
    if (newNonce) {
      this.dpopNonce = newNonce;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      throw new Error(err.message || err.error || res.statusText);
    }
    const contentType = res.headers.get("content-type") ||
      "application/octet-stream";
    const data = new Uint8Array(await res.arrayBuffer());
    return { data, contentType };
  }

  async uploadBlob(
    data: Uint8Array,
    mimeType: string,
  ): Promise<{ blob: BlobRef }> {
    return this.xrpc("com.atproto.repo.uploadBlob", {
      httpMethod: "POST",
      rawBody: data,
      contentType: mimeType,
    });
  }

  async getPreferences(): Promise<Preferences> {
    return this.xrpc("app.bsky.actor.getPreferences");
  }

  async putPreferences(preferences: Preferences): Promise<void> {
    await this.xrpc("app.bsky.actor.putPreferences", {
      httpMethod: "POST",
      body: preferences,
    });
  }

  async createAccount(
    params: CreateAccountParams,
    serviceToken?: string,
  ): Promise<Session> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (serviceToken) {
      headers["Authorization"] = `Bearer ${serviceToken}`;
    }

    const res = await fetch(
      `${this.baseUrl}/xrpc/com.atproto.server.createAccount`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      const error = new Error(err.message || err.error || res.statusText) as
        & Error
        & {
          status: number;
          error: string;
        };
      error.status = res.status;
      error.error = err.error;
      throw error;
    }

    const session = (await res.json()) as Session;
    this.accessToken = session.accessJwt;
    this.refreshToken = session.refreshJwt;
    return session;
  }

  async importRepo(car: Uint8Array): Promise<void> {
    await this.xrpc("com.atproto.repo.importRepo", {
      httpMethod: "POST",
      rawBody: car,
      contentType: "application/vnd.ipld.car",
    });
  }

  async listMissingBlobs(
    cursor?: string,
    limit = 100,
  ): Promise<
    { blobs: Array<{ cid: string; recordUri: string }>; cursor?: string }
  > {
    const params: Record<string, string> = { limit: String(limit) };
    if (cursor) {
      params.cursor = cursor;
    }
    return this.xrpc("com.atproto.repo.listMissingBlobs", { params });
  }

  async requestPlcOperationSignature(): Promise<void> {
    await this.xrpc("com.atproto.identity.requestPlcOperationSignature", {
      httpMethod: "POST",
    });
  }

  async signPlcOperation(params: {
    token?: string;
    rotationKeys?: string[];
    alsoKnownAs?: string[];
    verificationMethods?: { atproto?: string };
    services?: { atproto_pds?: { type: string; endpoint: string } };
  }): Promise<{ operation: PlcOperation }> {
    return this.xrpc("com.atproto.identity.signPlcOperation", {
      httpMethod: "POST",
      body: params,
    });
  }

  async submitPlcOperation(operation: PlcOperation): Promise<void> {
    apiLog(
      "POST",
      `${this.baseUrl}/xrpc/com.atproto.identity.submitPlcOperation`,
      {
        operationType: operation.type,
        operationPrev: operation.prev,
      },
    );
    const start = Date.now();
    await this.xrpc("com.atproto.identity.submitPlcOperation", {
      httpMethod: "POST",
      body: { operation },
    });
    apiLog(
      "POST",
      `${this.baseUrl}/xrpc/com.atproto.identity.submitPlcOperation COMPLETE`,
      {
        durationMs: Date.now() - start,
      },
    );
  }

  async getRecommendedDidCredentials(): Promise<DidCredentials> {
    return this.xrpc("com.atproto.identity.getRecommendedDidCredentials");
  }

  async activateAccount(): Promise<void> {
    apiLog("POST", `${this.baseUrl}/xrpc/com.atproto.server.activateAccount`);
    const start = Date.now();
    await this.xrpc("com.atproto.server.activateAccount", {
      httpMethod: "POST",
    });
    apiLog(
      "POST",
      `${this.baseUrl}/xrpc/com.atproto.server.activateAccount COMPLETE`,
      {
        durationMs: Date.now() - start,
      },
    );
  }

  async deactivateAccount(): Promise<void> {
    apiLog(
      "POST",
      `${this.baseUrl}/xrpc/com.atproto.server.deactivateAccount`,
    );
    const start = Date.now();
    try {
      await this.xrpc("com.atproto.server.deactivateAccount", {
        httpMethod: "POST",
      });
      apiLog(
        "POST",
        `${this.baseUrl}/xrpc/com.atproto.server.deactivateAccount COMPLETE`,
        {
          durationMs: Date.now() - start,
          success: true,
        },
      );
    } catch (e) {
      const err = e as Error & { error?: string; status?: number };
      apiLog(
        "POST",
        `${this.baseUrl}/xrpc/com.atproto.server.deactivateAccount FAILED`,
        {
          durationMs: Date.now() - start,
          error: err.message,
          errorCode: err.error,
          status: err.status,
        },
      );
      throw e;
    }
  }

  async checkAccountStatus(): Promise<AccountStatus> {
    return this.xrpc("com.atproto.server.checkAccountStatus");
  }

  async resolveHandle(handle: string): Promise<{ did: string }> {
    return this.xrpc("com.atproto.identity.resolveHandle", {
      params: { handle },
    });
  }

  async loginDeactivated(
    identifier: string,
    password: string,
  ): Promise<Session> {
    const session = await this.xrpc<Session>(
      "com.atproto.server.createSession",
      {
        httpMethod: "POST",
        body: { identifier, password, allowDeactivated: true },
      },
    );
    this.accessToken = session.accessJwt;
    this.refreshToken = session.refreshJwt;
    return session;
  }

  async checkEmailVerified(identifier: string): Promise<boolean> {
    const result = await this.xrpc<{ verified: boolean }>(
      "_checkEmailVerified",
      {
        httpMethod: "POST",
        body: { identifier },
      },
    );
    return result.verified;
  }

  async checkChannelVerified(
    did: string,
    channel: string,
  ): Promise<boolean> {
    const result = await this.xrpc<{ verified: boolean }>(
      "_checkChannelVerified",
      {
        httpMethod: "POST",
        body: { did, channel },
      },
    );
    return result.verified;
  }

  async verifyToken(
    token: string,
    identifier: string,
  ): Promise<
    { success: boolean; did: string; purpose: string; channel: string }
  > {
    return this.xrpc("_account.verifyToken", {
      httpMethod: "POST",
      body: { token, identifier },
    });
  }

  async verifyHandleOwnership(
    handle: string,
    did: string,
  ): Promise<{ verified: boolean; method?: string; error?: string }> {
    return this.xrpc("_identity.verifyHandleOwnership", {
      httpMethod: "POST",
      body: { handle, did },
    });
  }

  async resendMigrationVerification(
    channel: string,
    identifier: string,
  ): Promise<void> {
    await this.xrpc("com.atproto.server.resendMigrationVerification", {
      httpMethod: "POST",
      body: { channel, identifier },
    });
  }

  async createPasskeyAccount(
    params: CreatePasskeyAccountParams,
    serviceToken?: string,
  ): Promise<PasskeyAccountSetup> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (serviceToken) {
      headers["Authorization"] = `Bearer ${serviceToken}`;
    }

    const res = await fetch(
      `${this.baseUrl}/xrpc/_account.createPasskeyAccount`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      const error = new Error(err.message || err.error || res.statusText) as
        & Error
        & {
          status: number;
          error: string;
        };
      error.status = res.status;
      error.error = err.error;
      throw error;
    }

    return res.json();
  }

  async startPasskeyRegistrationForSetup(
    did: string,
    setupToken: string,
    friendlyName?: string,
  ): Promise<StartPasskeyRegistrationResponse> {
    return this.xrpc("_account.startPasskeyRegistrationForSetup", {
      httpMethod: "POST",
      body: { did, setupToken, friendlyName },
    });
  }

  async completePasskeySetup(
    did: string,
    setupToken: string,
    passkeyCredential: unknown,
    passkeyFriendlyName?: string,
  ): Promise<CompletePasskeySetupResponse> {
    return this.xrpc("_account.completePasskeySetup", {
      httpMethod: "POST",
      body: { did, setupToken, passkeyCredential, passkeyFriendlyName },
    });
  }
}

export async function getOAuthServerMetadata(
  pdsUrl: string,
): Promise<OAuthServerMetadata | null> {
  try {
    const directUrl = `${pdsUrl}/.well-known/oauth-authorization-server`;
    const directRes = await fetch(directUrl);
    if (directRes.ok) {
      return directRes.json();
    }

    const protectedResourceUrl =
      `${pdsUrl}/.well-known/oauth-protected-resource`;
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

function base64UrlEncode(buffer: Uint8Array | ArrayBuffer): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

async function computeAccessTokenHash(accessToken: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(accessToken);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
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
            retryErr.error_description || retryErr.error ||
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
        "DPoP": dpopProof,
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
            retryErr.error_description || retryErr.error ||
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

export async function resolveDidDocument(did: string): Promise<DidDocument> {
  if (did.startsWith("did:plc:")) {
    const res = await fetch(`https://plc.directory/${did}`);
    if (!res.ok) {
      throw new Error(`Failed to resolve DID: ${res.statusText}`);
    }
    return res.json();
  }

  if (did.startsWith("did:web:")) {
    const domain = did.slice(8).replace(/%3A/g, ":");
    const url = domain.includes("/")
      ? `https://${domain}/did.json`
      : `https://${domain}/.well-known/did.json`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to resolve DID: ${res.statusText}`);
    }
    return res.json();
  }

  throw new Error(`Unsupported DID method: ${did}`);
}

export async function resolvePdsUrl(
  handleOrDid: string,
): Promise<{ did: string; pdsUrl: string }> {
  let did: string | undefined;

  if (handleOrDid.startsWith("did:")) {
    did = handleOrDid;
  } else {
    const handle = handleOrDid.replace(/^@/, "");

    if (handle.endsWith(".bsky.social")) {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${
          encodeURIComponent(handle)
        }`,
      );
      if (!res.ok) {
        throw new Error(`Failed to resolve handle: ${res.statusText}`);
      }
      const data = await res.json();
      did = data.did;
    } else {
      const dnsRes = await fetch(
        `https://dns.google/resolve?name=_atproto.${handle}&type=TXT`,
      );
      if (dnsRes.ok) {
        const dnsData = await dnsRes.json();
        const txtRecords: Array<{ data?: string }> = dnsData.Answer ?? [];
        const didRecord = txtRecords
          .map((record) => record.data?.replace(/"/g, "") ?? "")
          .find((txt) => txt.startsWith("did="));
        if (didRecord) {
          did = didRecord.slice(4);
        }
      }

      if (!did) {
        const wellKnownRes = await fetch(
          `https://${handle}/.well-known/atproto-did`,
        );
        if (wellKnownRes.ok) {
          did = (await wellKnownRes.text()).trim();
        }
      }

      if (!did) {
        throw new Error(`Could not resolve handle: ${handle}`);
      }
    }
  }

  if (!did) {
    throw new Error("Could not resolve DID");
  }

  const didDoc = await resolveDidDocument(did);

  const pdsService = didDoc.service?.find(
    (s: { type: string }) => s.type === "AtprotoPersonalDataServer",
  );

  if (!pdsService) {
    throw new Error("No PDS service found in DID document");
  }

  return { did, pdsUrl: pdsService.serviceEndpoint };
}

export function createLocalClient(): AtprotoClient {
  return new AtprotoClient(globalThis.location.origin);
}

export function getMigrationOAuthClientId(): string {
  return `${globalThis.location.origin}/oauth-client-metadata.json`;
}

export function getMigrationOAuthRedirectUri(): string {
  return `${globalThis.location.origin}/app/migrate`;
}

export interface DPoPKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  jwk: JsonWebKey;
  thumbprint: string;
}

const DPOP_KEY_STORAGE = "migration_dpop_key";
const DPOP_KEY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function generateDPoPKeyPair(): Promise<DPoPKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign", "verify"],
  );

  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const thumbprint = await computeJwkThumbprint(publicJwk);

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    jwk: publicJwk,
    thumbprint,
  };
}

async function computeJwkThumbprint(jwk: JsonWebKey): Promise<string> {
  const thumbprintInput = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(thumbprintInput);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
}

export async function saveDPoPKey(keyPair: DPoPKeyPair): Promise<void> {
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const stored = {
    privateJwk,
    publicJwk: keyPair.jwk,
    thumbprint: keyPair.thumbprint,
    createdAt: Date.now(),
  };
  localStorage.setItem(DPOP_KEY_STORAGE, JSON.stringify(stored));
}

export async function loadDPoPKey(): Promise<DPoPKeyPair | null> {
  const stored = localStorage.getItem(DPOP_KEY_STORAGE);
  if (!stored) return null;

  try {
    const { privateJwk, publicJwk, thumbprint, createdAt } = JSON.parse(stored);

    if (createdAt && Date.now() - createdAt > DPOP_KEY_MAX_AGE_MS) {
      localStorage.removeItem(DPOP_KEY_STORAGE);
      return null;
    }

    const privateKey = await crypto.subtle.importKey(
      "jwk",
      privateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    );

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );

    return { privateKey, publicKey, jwk: publicJwk, thumbprint };
  } catch {
    localStorage.removeItem(DPOP_KEY_STORAGE);
    return null;
  }
}

export function clearDPoPKey(): void {
  localStorage.removeItem(DPOP_KEY_STORAGE);
}

export async function createDPoPProof(
  keyPair: DPoPKeyPair,
  httpMethod: string,
  httpUri: string,
  nonce?: string,
  accessTokenHash?: string,
): Promise<string> {
  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: {
      kty: keyPair.jwk.kty,
      crv: keyPair.jwk.crv,
      x: keyPair.jwk.x,
      y: keyPair.jwk.y,
    },
  };

  const payload: Record<string, unknown> = {
    jti: crypto.randomUUID(),
    htm: httpMethod,
    htu: httpUri,
    iat: Math.floor(Date.now() / 1000),
  };

  if (nonce) {
    payload.nonce = nonce;
  }

  if (accessTokenHash) {
    payload.ath = accessTokenHash;
  }

  const headerB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(header)),
  );
  const payloadB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );

  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}
