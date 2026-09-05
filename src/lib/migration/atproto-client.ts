import type {
  AccountStatus,
  BlobRef,
  CompletePasskeySetupResponse,
  CreateAccountParams,
  CreatePasskeyAccountParams,
  DidCredentials,
  PasskeyAccountSetup,
  PlcOperation,
  Preferences,
  ServerDescription,
  Session,
  StartPasskeyRegistrationResponse,
} from "./types.ts";
import { Client } from "@atcute/client";
import {
  computeAccessTokenHash,
  createDPoPProof,
  type DPoPKeyPair,
} from "./dpop.ts";
import { refreshSourceOAuthToken } from "./oauth.ts";

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

export function createLocalClient(): AtprotoClient {
  return new AtprotoClient(globalThis.location.origin);
}

export {
  clearDPoPKey,
  createDPoPProof,
  generateDPoPKeyPair,
  loadDPoPKey,
  saveDPoPKey,
  type DPoPKeyPair,
} from "./dpop.ts";
export {
  buildOAuthAuthorizationUrl,
  exchangeOAuthCode,
  getMigrationOAuthClientId,
  getMigrationOAuthRedirectUri,
  getOAuthServerMetadata,
  initiateOAuthWithPAR,
  refreshSourceOAuthToken,
} from "./oauth.ts";
export { resolveDidDocument, resolvePdsUrl } from "./identity.ts";
