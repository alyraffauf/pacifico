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
import { Client } from "@atcute/client";
import { getPdsEndpoint } from "@atcute/identity";
import {
  DohJsonHandleResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  WellKnownHandleResolver,
  XrpcHandleResolver,
} from "@atcute/identity-resolver";

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

type AtcuteResponse =
  | { ok: true; status: number; headers: Headers; data: unknown }
  | {
      ok: false;
      status: number;
      headers: Headers;
      data: { error: string; message?: string };
    };

type XrpcError = Error & { status: number; error: string };

function createXrpcError(
  status: number,
  data: { error: string; message?: string },
): XrpcError {
  const error = new Error(data.message || data.error) as XrpcError;
  error.status = status;
  error.error = data.error;
  return error;
}

type TransportAuthentication =
  | { type: "session" }
  | { type: "token"; token: string; useDPoP: boolean }
  | { type: "none" };

interface RawRequestOptions {
  httpMethod?: "GET" | "POST";
  params?: Record<string, string>;
  body?: unknown;
  authToken?: string;
  useSession?: boolean;
  useDPoPForAuthToken?: boolean;
  rawBody?: Uint8Array | Blob;
  contentType?: string;
}

class XrpcTransport {
  readonly baseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private dpopKeyPair: DPoPKeyPair | null = null;
  private dpopNonce: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private oauthTokenEndpoint: string | null = null;
  private oauthClientId: string | null = null;

  constructor(pdsUrl: string) {
    this.baseUrl = pdsUrl.replace(/\/$/, "");
  }

  readonly handleAtcuteFetch = (
    pathname: string,
    init: RequestInit,
  ): Promise<Response> => {
    const url = new URL(pathname, `${this.baseUrl}/`).toString();
    const headers = new Headers(init.headers);
    const authorization = headers.get("Authorization");
    const authentication: TransportAuthentication = authorization
      ? {
          type: "token",
          token: authorization.replace(/^(?:Bearer|DPoP)\s+/i, ""),
          useDPoP: true,
        }
      : { type: "session" };

    headers.delete("Authorization");
    headers.delete("DPoP");
    return this.fetchWithAuth(url, { ...init, headers }, authentication);
  };

  async request<T>(
    pathname: string,
    options: RawRequestOptions = {},
  ): Promise<T> {
    const {
      httpMethod = "GET",
      params,
      body,
      authToken,
      useSession = true,
      useDPoPForAuthToken = true,
      rawBody,
      contentType,
    } = options;
    const url = new URL(`/xrpc/${pathname}`, `${this.baseUrl}/`);
    if (params) {
      url.search = new URLSearchParams(params).toString();
    }

    const headers = new Headers();
    let requestBody: BodyInit | undefined;
    if (rawBody) {
      headers.set("Content-Type", contentType ?? "application/octet-stream");
      requestBody = rawBody as BodyInit;
    } else if (body) {
      headers.set("Content-Type", "application/json");
      requestBody = JSON.stringify(body);
    } else if (httpMethod === "POST") {
      headers.set("Content-Type", "application/json");
    }

    const authentication: TransportAuthentication = authToken
      ? { type: "token", token: authToken, useDPoP: useDPoPForAuthToken }
      : useSession
        ? { type: "session" }
        : { type: "none" };
    const response = await this.fetchWithAuth(
      url.toString(),
      { method: httpMethod, headers, body: requestBody },
      authentication,
    );
    if (!response.ok) {
      throw createXrpcError(response.status, await this.readError(response));
    }

    const responseContentType = response.headers.get("content-type") ?? "";
    if (responseContentType.includes("application/json")) {
      return response.json();
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer) as T;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  setRefreshToken(token: string | null): void {
    this.refreshToken = token;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  setDPoPKeyPair(keyPair: DPoPKeyPair | null): void {
    this.dpopKeyPair = keyPair;
  }

  setOAuthRefreshContext(tokenEndpoint: string, clientId: string): void {
    this.oauthTokenEndpoint = tokenEndpoint;
    this.oauthClientId = clientId;
  }

  private async fetchWithAuth(
    url: string,
    init: RequestInit,
    authentication: TransportAuthentication,
  ): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const canReplay = !(init.body instanceof ReadableStream);
    let usedNonceRetry = false;

    const send = async (): Promise<Response> => {
      const headers = new Headers(init.headers);
      const token =
        authentication.type === "session"
          ? this.accessToken
          : authentication.type === "token"
            ? authentication.token
            : null;
      const useDPoP =
        Boolean(this.dpopKeyPair) &&
        authentication.type !== "none" &&
        (authentication.type === "session" || authentication.useDPoP);

      if (token) {
        if (useDPoP && this.dpopKeyPair) {
          headers.set("Authorization", `DPoP ${token}`);
          headers.set(
            "DPoP",
            await createDPoPProof(
              this.dpopKeyPair,
              method,
              url.split("?")[0]!,
              this.dpopNonce ?? undefined,
              await computeAccessTokenHash(token),
            ),
          );
        } else {
          headers.set("Authorization", `Bearer ${token}`);
        }
      }
      return fetch(url, { ...init, method, headers });
    };

    const sendWithNonceRetry = async (): Promise<Response> => {
      let response = await send();
      const responseNonce = response.headers.get("DPoP-Nonce");
      if (responseNonce) {
        const nonceChanged = responseNonce !== this.dpopNonce;
        this.dpopNonce = responseNonce;
        if (
          !response.ok &&
          nonceChanged &&
          this.dpopKeyPair &&
          canReplay &&
          !usedNonceRetry
        ) {
          usedNonceRetry = true;
          response = await send();
          this.captureNonce(response);
        }
      }
      return response;
    };

    const response = await sendWithNonceRetry();
    if (
      response.ok ||
      authentication.type !== "session" ||
      !canReplay ||
      !(await this.isExpiredTokenResponse(response)) ||
      !(await this.tryRefreshToken())
    ) {
      return response;
    }

    return sendWithNonceRetry();
  }

  private captureNonce(response: Response): void {
    const nonce = response.headers.get("DPoP-Nonce");
    if (nonce) {
      this.dpopNonce = nonce;
    }
  }

  private async isExpiredTokenResponse(response: Response): Promise<boolean> {
    if (response.status !== 400 && response.status !== 401) {
      return false;
    }
    const data = await this.readError(response.clone());
    return (
      data.error === "ExpiredToken" ||
      data.error === "invalid_token" ||
      Boolean(data.message?.includes("expired"))
    );
  }

  private async readError(
    response: Response,
  ): Promise<{ error: string; message?: string }> {
    return response.json().catch(() => ({
      error: "Unknown",
      message: response.statusText,
    }));
  }

  private async tryRefreshToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    if (!this.refreshToken) return false;

    const refreshPromise = this.refreshTokenInternal();
    this.refreshPromise = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (this.refreshPromise === refreshPromise) {
        this.refreshPromise = null;
      }
    }
  }

  private async refreshTokenInternal(): Promise<boolean> {
    try {
      if (this.dpopKeyPair && this.oauthTokenEndpoint && this.oauthClientId) {
        const tokens = await refreshSourceOAuthToken(this.oauthTokenEndpoint, {
          refreshToken: this.refreshToken!,
          clientId: this.oauthClientId,
          dpopKeyPair: this.dpopKeyPair,
          nonce: this.dpopNonce ?? undefined,
        });
        this.accessToken = tokens.access_token;
        this.refreshToken = tokens.refresh_token ?? this.refreshToken;
        return true;
      }
      const session = await this.refreshSessionInternal(this.refreshToken!);
      this.accessToken = session.accessJwt;
      this.refreshToken = session.refreshJwt;
      return true;
    } catch {
      return false;
    }
  }

  private async refreshSessionInternal(refreshJwt: string): Promise<Session> {
    const response = await this.fetchWithAuth(
      `${this.baseUrl}/xrpc/com.atproto.server.refreshSession`,
      { method: "POST" },
      { type: "token", token: refreshJwt, useDPoP: true },
    );
    if (!response.ok) {
      throw new Error("Token refresh failed");
    }
    return response.json();
  }
}

export class AtprotoClient {
  private readonly transport: XrpcTransport;
  private readonly client: Client;

  constructor(pdsUrl: string) {
    this.transport = new XrpcTransport(pdsUrl);
    this.client = new Client({
      handler: this.transport.handleAtcuteFetch,
    });
  }

  private async unwrapAtcute<T>(request: Promise<AtcuteResponse>): Promise<T> {
    const response = await request;
    if (!response.ok) {
      throw createXrpcError(response.status, response.data);
    }
    return response.data as T;
  }

  setAccessToken(token: string | null) {
    this.transport.setAccessToken(token);
  }

  getAccessToken(): string | null {
    return this.transport.getAccessToken();
  }

  setRefreshToken(token: string | null) {
    this.transport.setRefreshToken(token);
  }

  getRefreshToken(): string | null {
    return this.transport.getRefreshToken();
  }

  getBaseUrl(): string {
    return this.transport.baseUrl;
  }

  setDPoPKeyPair(keyPair: DPoPKeyPair | null) {
    this.transport.setDPoPKeyPair(keyPair);
  }

  setOAuthRefreshContext(tokenEndpoint: string, clientId: string) {
    this.transport.setOAuthRefreshContext(tokenEndpoint, clientId);
  }

  private xrpc<T>(method: string, options?: RawRequestOptions): Promise<T> {
    return this.transport.request(method, options);
  }
  async login(
    identifier: string,
    password: string,
    authFactorToken?: string,
  ): Promise<Session> {
    const session = await this.unwrapAtcute<Session>(
      this.client.post("com.atproto.server.createSession", {
        input: { identifier, password, authFactorToken },
      }),
    );

    this.setAccessToken(session.accessJwt);
    this.setRefreshToken(session.refreshJwt);
    return session;
  }

  async refreshSession(refreshJwt: string): Promise<Session> {
    const session = await this.unwrapAtcute<Session>(
      this.client.post("com.atproto.server.refreshSession", {
        headers: { Authorization: `Bearer ${refreshJwt}` },
      }),
    );
    this.setAccessToken(session.accessJwt);
    return session;
  }

  describeServer(): Promise<ServerDescription> {
    return this.unwrapAtcute(
      this.client.get("com.atproto.server.describeServer"),
    );
  }

  getServiceAuth(aud: string, lxm?: string): Promise<{ token: string }> {
    return this.unwrapAtcute(
      this.client.get("com.atproto.server.getServiceAuth", {
        params: {
          aud,
          lxm: lxm as `${string}.${string}.${string}` | undefined,
        },
      }),
    );
  }

  getRepo(did: string): Promise<Uint8Array> {
    return this.unwrapAtcute(
      this.client.get("com.atproto.sync.getRepo", {
        params: { did: did as `did:${string}:${string}` },
        as: "bytes",
      }),
    );
  }

  async listBlobs(
    did: string,
    cursor?: string,
    limit = 100,
  ): Promise<{ cids: string[]; cursor?: string }> {
    return this.unwrapAtcute(
      this.client.get("com.atproto.sync.listBlobs", {
        params: {
          did: did as `did:${string}:${string}`,
          limit,
          cursor,
        },
      }),
    );
  }

  async getBlob(did: string, cid: string): Promise<Uint8Array> {
    return this.unwrapAtcute(
      this.client.get("com.atproto.sync.getBlob", {
        params: {
          did: did as `did:${string}:${string}`,
          cid: cid as `${string}.${string}`,
        },
        as: "bytes",
      }),
    );
  }

  async getBlobWithContentType(
    did: string,
    cid: string,
  ): Promise<{ data: Uint8Array; contentType: string }> {
    const response = (await this.client.get("com.atproto.sync.getBlob", {
      params: {
        did: did as `did:${string}:${string}`,
        cid: cid as `${string}.${string}`,
      },
      as: "bytes",
    })) as AtcuteResponse;
    if (!response.ok) {
      throw createXrpcError(response.status, response.data);
    }
    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const data = response.data as Uint8Array;
    return { data, contentType };
  }

  async uploadBlob(
    data: Uint8Array,
    mimeType: string,
  ): Promise<{ blob: BlobRef }> {
    return this.unwrapAtcute(
      this.client.post("com.atproto.repo.uploadBlob", {
        input: data,
        headers: { "Content-Type": mimeType },
      }),
    );
  }

  async getPreferences(): Promise<Preferences> {
    return this.unwrapAtcute(
      this.client.get("app.bsky.actor.getPreferences", { params: {} }),
    );
  }

  async putPreferences(preferences: Preferences): Promise<void> {
    await this.unwrapAtcute(
      this.client.post("app.bsky.actor.putPreferences", {
        input: preferences as never,
        as: null,
      }),
    );
  }

  async createAccount(
    params: CreateAccountParams,
    serviceToken?: string,
  ): Promise<Session> {
    const session = await this.xrpc<Session>(
      "com.atproto.server.createAccount",
      {
        httpMethod: "POST",
        body: params,
        authToken: serviceToken,
        useDPoPForAuthToken: false,
        useSession: false,
      },
    );
    this.setAccessToken(session.accessJwt);
    this.setRefreshToken(session.refreshJwt);
    return session;
  }

  async importRepo(car: Uint8Array): Promise<void> {
    await this.unwrapAtcute(
      this.client.post("com.atproto.repo.importRepo", {
        input: car,
        headers: { "Content-Type": "application/vnd.ipld.car" },
        as: null,
      }),
    );
  }

  async listMissingBlobs(
    cursor?: string,
    limit = 100,
  ): Promise<{
    blobs: Array<{ cid: string; recordUri: string }>;
    cursor?: string;
  }> {
    const params: Record<string, string> = { limit: String(limit) };
    if (cursor) {
      params.cursor = cursor;
    }
    return this.unwrapAtcute(
      this.client.get("com.atproto.repo.listMissingBlobs", { params }),
    );
  }

  async requestPlcOperationSignature(): Promise<void> {
    await this.unwrapAtcute(
      this.client.post("com.atproto.identity.requestPlcOperationSignature", {
        as: null,
      }),
    );
  }

  async signPlcOperation(params: {
    token?: string;
    rotationKeys?: string[];
    alsoKnownAs?: string[];
    verificationMethods?: { atproto?: string };
    services?: { atproto_pds?: { type: string; endpoint: string } };
  }): Promise<{ operation: PlcOperation }> {
    return this.unwrapAtcute(
      this.client.post("com.atproto.identity.signPlcOperation", {
        input: params,
      }),
    );
  }

  async submitPlcOperation(operation: PlcOperation): Promise<void> {
    apiLog(
      "POST",
      `${this.getBaseUrl()}/xrpc/com.atproto.identity.submitPlcOperation`,
      {
        operationType: operation.type,
        operationPrev: operation.prev,
      },
    );
    const start = Date.now();
    await this.unwrapAtcute(
      this.client.post("com.atproto.identity.submitPlcOperation", {
        input: { operation: operation as unknown as Record<string, unknown> },
        as: null,
      }),
    );
    apiLog(
      "POST",
      `${this.getBaseUrl()}/xrpc/com.atproto.identity.submitPlcOperation COMPLETE`,
      {
        durationMs: Date.now() - start,
      },
    );
  }

  async getRecommendedDidCredentials(): Promise<DidCredentials> {
    return this.unwrapAtcute(
      this.client.get("com.atproto.identity.getRecommendedDidCredentials"),
    );
  }

  async activateAccount(): Promise<void> {
    apiLog(
      "POST",
      `${this.getBaseUrl()}/xrpc/com.atproto.server.activateAccount`,
    );
    const start = Date.now();
    await this.unwrapAtcute(
      this.client.post("com.atproto.server.activateAccount", { as: null }),
    );
    apiLog(
      "POST",
      `${this.getBaseUrl()}/xrpc/com.atproto.server.activateAccount COMPLETE`,
      {
        durationMs: Date.now() - start,
      },
    );
  }

  async deactivateAccount(): Promise<void> {
    apiLog(
      "POST",
      `${this.getBaseUrl()}/xrpc/com.atproto.server.deactivateAccount`,
    );
    const start = Date.now();
    try {
      await this.unwrapAtcute(
        this.client.post("com.atproto.server.deactivateAccount", {
          input: {},
          as: null,
        }),
      );
      apiLog(
        "POST",
        `${this.getBaseUrl()}/xrpc/com.atproto.server.deactivateAccount COMPLETE`,
        {
          durationMs: Date.now() - start,
          success: true,
        },
      );
    } catch (e) {
      const err = e as Error & { error?: string; status?: number };
      apiLog(
        "POST",
        `${this.getBaseUrl()}/xrpc/com.atproto.server.deactivateAccount FAILED`,
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
    return this.unwrapAtcute(
      this.client.get("com.atproto.server.checkAccountStatus"),
    );
  }

  async resolveHandle(handle: string): Promise<{ did: string }> {
    return this.unwrapAtcute(
      this.client.get("com.atproto.identity.resolveHandle", {
        params: { handle: handle as `${string}.${string}` },
      }),
    );
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
    this.setAccessToken(session.accessJwt);
    this.setRefreshToken(session.refreshJwt);
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

  async checkChannelVerified(did: string, channel: string): Promise<boolean> {
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
  ): Promise<{
    success: boolean;
    did: string;
    purpose: string;
    channel: string;
  }> {
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
    return this.xrpc("_account.createPasskeyAccount", {
      httpMethod: "POST",
      body: params,
      authToken: serviceToken,
      useDPoPForAuthToken: false,
      useSession: false,
    });
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

function base64UrlEncode(buffer: Uint8Array | ArrayBuffer): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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

export async function resolveDidDocument(did: string): Promise<DidDocument> {
  if (did.startsWith("did:plc:")) {
    const resolver = new PlcDidDocumentResolver({ fetch });
    return resolver.resolve(
      did as Parameters<typeof resolver.resolve>[0],
    ) as Promise<DidDocument>;
  }

  if (did.startsWith("did:web:")) {
    const resolver = new WebDidDocumentResolver({ fetch });
    return resolver.resolve(
      did as Parameters<typeof resolver.resolve>[0],
    ) as Promise<DidDocument>;
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
      const resolver = new XrpcHandleResolver({
        serviceUrl: "https://public.api.bsky.app",
        fetch,
      });
      did = await resolver.resolve(
        handle as Parameters<typeof resolver.resolve>[0],
      );
    } else {
      const dnsResolver = new DohJsonHandleResolver({
        dohUrl: "https://dns.google/resolve",
        fetch,
      });
      try {
        did = await dnsResolver.resolve(
          handle as Parameters<typeof dnsResolver.resolve>[0],
        );
      } catch {
        const wellKnownResolver = new WellKnownHandleResolver({ fetch });
        try {
          did = await wellKnownResolver.resolve(
            handle as Parameters<typeof wellKnownResolver.resolve>[0],
          );
        } catch {
          throw new Error(`Could not resolve handle: ${handle}`);
        }
      }
    }
  }

  if (!did) {
    throw new Error("Could not resolve DID");
  }

  const didDoc = await resolveDidDocument(did);

  const pdsUrl = getPdsEndpoint(didDoc as Parameters<typeof getPdsEndpoint>[0]);
  if (!pdsUrl) {
    throw new Error("No PDS service found in DID document");
  }

  return { did, pdsUrl };
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
