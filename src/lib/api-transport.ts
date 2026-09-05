import type { ApiErrorCode } from "./types/api.ts";
import type { AccessToken, Did, RefreshToken } from "./types/branded.ts";
import { unsafeAsDid } from "./types/branded.ts";
import { createDPoPProofForRequest, setDPoPNonce } from "./oauth.ts";

const STATUS_FALLBACK_MESSAGE: Record<number, string> = {
  400: "Bad request",
  401: "Authentication required",
  403: "Forbidden",
  404: "Not found",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway",
  503: "Service unavailable",
  504: "Gateway timeout",
};

export class ApiError extends Error {
  public did?: Did;
  public reauthMethods?: string[];

  constructor(
    public status: number,
    public error: ApiErrorCode,
    message: string,
    did?: string,
    reauthMethods?: string[],
  ) {
    super(message || STATUS_FALLBACK_MESSAGE[status] || "Request failed");
    this.name = "ApiError";
    this.did = did ? unsafeAsDid(did) : undefined;
    this.reauthMethods = reauthMethods;
  }
}

export type TransportAuthentication =
  | { type: "none" }
  | { type: "refreshable-dpop"; token: AccessToken }
  | { type: "dpop"; token: AccessToken | RefreshToken }
  | { type: "bearer"; token: string };

export interface RawRequestOptions {
  method?: "GET" | "POST";
  params?: Record<string, string>;
  headers?: HeadersInit;
  body?: BodyInit | null;
  authentication?: TransportAuthentication;
  retryNonce?: boolean;
  retryNonceOnAnyFailure?: boolean;
  retryExpiredToken?: boolean;
}

interface ErrorData {
  error: string;
  message?: string;
  error_description?: string;
  did?: string;
  reauthMethods?: string[];
}

type TokenRefreshCallback = () => Promise<AccessToken | null>;

const expiredTokenErrors = new Set([
  "AuthenticationFailed",
  "ExpiredToken",
  "OAuthExpiredToken",
]);

export class MainApiTransport {
  private tokenRefreshCallback: TokenRefreshCallback | null = null;
  private refreshPromise: Promise<AccessToken | null> | null = null;

  setTokenRefreshCallback(callback: TokenRefreshCallback): void {
    this.tokenRefreshCallback = callback;
  }

  readonly handleAtcuteFetch = (
    pathname: string,
    init: RequestInit,
  ): Promise<Response> => this.handleAtcuteRequest(pathname, init, true);

  readonly handleAtcuteFetchWithoutRefresh = (
    pathname: string,
    init: RequestInit,
  ): Promise<Response> => this.handleAtcuteRequest(pathname, init, false);

  async requestXrpc<T>(
    nsid: string,
    options: RawRequestOptions = {},
  ): Promise<T> {
    const path = `/xrpc/${nsid}`;
    const response = await this.request(path, options);
    if (!response.ok) {
      throw await this.createApiError(response);
    }
    return response.json() as Promise<T>;
  }

  async requestJson<T>(
    path: string,
    options: RawRequestOptions = {},
  ): Promise<T> {
    const response = await this.request(path, options);
    if (!response.ok) {
      throw await this.createApiError(response);
    }
    return response.json() as Promise<T>;
  }

  async request(
    path: string,
    options: RawRequestOptions = {},
  ): Promise<Response> {
    const {
      method = "GET",
      params,
      headers,
      body,
      authentication = { type: "none" },
      retryNonce = true,
      retryNonceOnAnyFailure = false,
      retryExpiredToken = true,
    } = options;
    const relativeUrl = this.buildRelativeUrl(path, params);
    return this.fetchWithAuth(
      relativeUrl,
      { method, headers, body },
      authentication,
      {
        retryNonce,
        retryNonceOnAnyFailure,
        retryExpiredToken,
      },
    );
  }

  async createApiError(response: Response): Promise<ApiError> {
    const data = await this.readError(response);
    const message =
      response.status === 429
        ? data.message || "Too many requests. Please try again later."
        : (data.error_description ?? data.message);
    return new ApiError(
      response.status,
      data.error as ApiErrorCode,
      message ?? response.statusText,
      data.did,
      data.reauthMethods,
    );
  }

  createApiErrorFromData(
    status: number,
    data: unknown,
    statusText = "",
  ): ApiError {
    const errorData = this.normalizeErrorData(data, statusText);
    const message =
      status === 429
        ? errorData.message || "Too many requests. Please try again later."
        : (errorData.error_description ?? errorData.message);
    return new ApiError(
      status,
      errorData.error as ApiErrorCode,
      message ?? statusText,
      errorData.did,
      errorData.reauthMethods,
    );
  }

  private async handleAtcuteRequest(
    pathname: string,
    init: RequestInit,
    refreshable: boolean,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    const authorization = headers.get("Authorization");
    headers.delete("Authorization");
    headers.delete("DPoP");

    let authentication: TransportAuthentication = { type: "none" };
    if (authorization) {
      const token = authorization.replace(/^(?:Bearer|DPoP)\s+/i, "");
      authentication = refreshable
        ? { type: "refreshable-dpop", token: token as AccessToken }
        : { type: "dpop", token: token as AccessToken };
    }

    return this.fetchWithAuth(pathname, { ...init, headers }, authentication, {
      retryNonce: true,
      retryNonceOnAnyFailure: false,
      retryExpiredToken: refreshable,
    });
  }

  private buildRelativeUrl(
    path: string,
    params?: Record<string, string>,
  ): string {
    if (!params || Object.keys(params).length === 0) return path;
    return `${path}?${new URLSearchParams(params)}`;
  }

  private async fetchWithAuth(
    relativeUrl: string,
    init: RequestInit,
    authentication: TransportAuthentication,
    retryPolicy: {
      retryNonce: boolean;
      retryNonceOnAnyFailure: boolean;
      retryExpiredToken: boolean;
    },
  ): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const canReplay = !(init.body instanceof ReadableStream);
    let currentAuthentication = authentication;
    let usedNonceRetry = false;

    const send = async (): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (currentAuthentication.type === "bearer") {
        headers.set("Authorization", `Bearer ${currentAuthentication.token}`);
      } else if (currentAuthentication.type !== "none") {
        const absoluteUrl = new URL(relativeUrl, globalThis.location.origin);
        absoluteUrl.search = "";
        absoluteUrl.hash = "";
        headers.set("Authorization", `DPoP ${currentAuthentication.token}`);
        headers.set(
          "DPoP",
          await createDPoPProofForRequest(
            method,
            absoluteUrl.toString(),
            currentAuthentication.token,
          ),
        );
      }
      return fetch(relativeUrl, { ...init, method, headers });
    };

    const sendWithNonceRetry = async (): Promise<Response> => {
      let response = await send();
      const nonce = response.headers.get("DPoP-Nonce");
      if (nonce) setDPoPNonce(nonce);
      if (
        !response.ok &&
        canReplay &&
        retryPolicy.retryNonce &&
        !usedNonceRetry &&
        nonce &&
        (currentAuthentication.type === "dpop" ||
          currentAuthentication.type === "refreshable-dpop") &&
        (retryPolicy.retryNonceOnAnyFailure ||
          (await this.hasError(response, "use_dpop_nonce")))
      ) {
        usedNonceRetry = true;
        response = await send();
        const retryNonce = response.headers.get("DPoP-Nonce");
        if (retryNonce) setDPoPNonce(retryNonce);
      }
      return response;
    };

    const response = await sendWithNonceRetry();
    if (
      response.ok ||
      currentAuthentication.type !== "refreshable-dpop" ||
      !canReplay ||
      !retryPolicy.retryExpiredToken ||
      !(await this.hasExpiredTokenError(response))
    ) {
      return response;
    }

    const freshToken = await this.refreshToken();
    if (!freshToken || freshToken === currentAuthentication.token) {
      return response;
    }
    currentAuthentication = { type: "refreshable-dpop", token: freshToken };
    return sendWithNonceRetry();
  }

  private async hasError(response: Response, error: string): Promise<boolean> {
    if (response.status !== 401) return false;
    return (await this.readError(response.clone())).error === error;
  }

  private async hasExpiredTokenError(response: Response): Promise<boolean> {
    if (response.status !== 401) return false;
    return expiredTokenErrors.has(
      (await this.readError(response.clone())).error,
    );
  }

  private async refreshToken(): Promise<AccessToken | null> {
    if (!this.tokenRefreshCallback) return null;
    if (this.refreshPromise) return this.refreshPromise;

    const refreshPromise = this.tokenRefreshCallback();
    this.refreshPromise = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
    }
  }

  private async readError(response: Response): Promise<ErrorData> {
    const data = await response.json().catch(() => undefined);
    return this.normalizeErrorData(data, response.statusText);
  }

  private normalizeErrorData(data: unknown, statusText: string): ErrorData {
    if (!data || typeof data !== "object") {
      return { error: "Unknown", message: statusText };
    }
    const value = data as Record<string, unknown>;
    return {
      error: typeof value.error === "string" ? value.error : "Unknown",
      message: typeof value.message === "string" ? value.message : statusText,
      error_description:
        typeof value.error_description === "string"
          ? value.error_description
          : undefined,
      did: typeof value.did === "string" ? value.did : undefined,
      reauthMethods: Array.isArray(value.reauthMethods)
        ? value.reauthMethods.filter(
            (method): method is string => typeof method === "string",
          )
        : undefined,
    };
  }
}

export const mainApiTransport = new MainApiTransport();

export function setTokenRefreshCallback(callback: TokenRefreshCallback): void {
  mainApiTransport.setTokenRefreshCallback(callback);
}
