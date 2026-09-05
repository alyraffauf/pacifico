import { err, ok, type Result } from "./types/result.ts";
import type {
  AccessToken,
  Did,
  EmailAddress,
  Handle,
  Nsid,
  RefreshToken,
  Rkey,
  ScopeSet,
} from "./types/branded.ts";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsISODate,
  unsafeAsRefreshToken,
  unsafeAsScopeSet,
} from "./types/branded.ts";
import {
  createDPoPProofForRequest,
  getDPoPNonce,
  setDPoPNonce,
} from "./oauth.ts";
import type {
  AccountInfo,
  AccountState,
  ApiErrorCode,
  AppPassword,
  CompletePasskeySetupResponse,
  ConfirmSignupResult,
  ContactState,
  CreateAccountParams,
  CreateAccountResult,
  CreatedAppPassword,
  CreateRecordResponse,
  DelegationAuditEntry,
  DelegationControlledAccount,
  DelegationController,
  DelegationScopePreset,
  DidDocument,
  DidType,
  EmailUpdateResponse,
  EnableTotpResponse,
  FinishPasskeyRegistrationResponse,
  GetInviteCodesResponse,
  InviteCodeInfo,
  LegacyLoginPreference,
  ListPasskeysResponse,
  ListRecordsResponse,
  ListReposResponse,
  ListSessionsResponse,
  ListTrustedDevicesResponse,
  NotificationHistoryResponse,
  NotificationPrefs,
  PasskeyAccountCreateResponse,
  PasswordStatus,
  ReauthPasskeyStartResponse,
  ReauthResponse,
  ReauthStatus,
  RecommendedDidCredentials,
  RecordResponse,
  RegenerateBackupCodesResponse,
  RepoDescription,
  ResendMigrationVerificationResponse,
  ReserveSigningKeyResponse,
  SearchAccountsResponse,
  ServerConfig,
  ServerDescription,
  ServerStats,
  SignalLinkResult,
  SignalStatus,
  Session,
  SsoLinkedAccount,
  StartPasskeyRegistrationResponse,
  SuccessResponse,
  TotpSecret,
  TotpStatus,
  UpdateLegacyLoginResponse,
  UpdateLocaleResponse,
  UpdateNotificationPrefsResponse,
  UploadBlobResponse,
  VerificationChannel,
  VerifyMigrationEmailResponse,
  VerifyTokenResponse,
} from "./types/api.ts";

const API_BASE = "/xrpc";

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
    super(message ?? STATUS_FALLBACK_MESSAGE[status] ?? "Request failed");
    this.name = "ApiError";
    this.did = did ? unsafeAsDid(did) : undefined;
    this.reauthMethods = reauthMethods;
  }
}

let tokenRefreshCallback: (() => Promise<AccessToken | null>) | null = null;

export function setTokenRefreshCallback(
  callback: () => Promise<AccessToken | null>,
) {
  tokenRefreshCallback = callback;
}

interface AuthenticatedFetchOptions {
  method?: "GET" | "POST";
  token: AccessToken | RefreshToken;
  headers?: Record<string, string>;
  body?: BodyInit;
}

async function authenticatedFetch(
  url: string,
  options: AuthenticatedFetchOptions,
): Promise<Response> {
  const { method = "GET", token, headers = {}, body } = options;
  const fullUrl = url.startsWith("http")
    ? url
    : `${globalThis.location.origin}${url}`;
  const dpopProof = await createDPoPProofForRequest(method, fullUrl, token);
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      Authorization: `DPoP ${token}`,
      DPoP: dpopProof,
    },
    body,
  });
  const dpopNonce = res.headers.get("DPoP-Nonce");
  if (dpopNonce) {
    setDPoPNonce(dpopNonce);
  }
  return res;
}

interface XrpcOptions {
  method?: "GET" | "POST";
  params?: Record<string, string>;
  body?: unknown;
  token?: AccessToken | RefreshToken;
  skipRetry?: boolean;
  skipDpopRetry?: boolean;
}

async function xrpc<T>(method: string, options?: XrpcOptions): Promise<T> {
  const {
    method: httpMethod = "GET",
    params,
    body,
    token,
    skipRetry,
    skipDpopRetry,
  } = options ?? {};
  let url = `${API_BASE}/${method}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams}`;
  }
  const headers: Record<string, string> = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  const res = token
    ? await authenticatedFetch(url, {
      method: httpMethod,
      token,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    : await fetch(url, {
      method: httpMethod,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({
      error: "Unknown",
      message: res.statusText,
    }));
    if (
      res.status === 401 &&
      errData.error === "use_dpop_nonce" &&
      token &&
      !skipDpopRetry &&
      getDPoPNonce()
    ) {
      return xrpc(method, { ...options, skipDpopRetry: true });
    }
    if (
      res.status === 401 &&
      (errData.error === "AuthenticationFailed" ||
        errData.error === "ExpiredToken" ||
        errData.error === "OAuthExpiredToken") &&
      token &&
      tokenRefreshCallback &&
      !skipRetry
    ) {
      const newToken = await tokenRefreshCallback();
      if (newToken && newToken !== token) {
        return xrpc(method, { ...options, token: newToken, skipRetry: true });
      }
    }
    const message = res.status === 429
      ? (errData.message || "Too many requests. Please try again later.")
      : errData.message;
    throw new ApiError(
      res.status,
      errData.error as ApiErrorCode,
      message,
      errData.did,
      errData.reauthMethods,
    );
  }
  return res.json();
}

async function xrpcResult<T>(
  method: string,
  options?: XrpcOptions,
): Promise<Result<T, ApiError>> {
  try {
    const value = await xrpc<T>(method, options);
    return ok(value);
  } catch (e) {
    if (e instanceof ApiError) {
      return err(e);
    }
    return err(
      new ApiError(0, "Unknown", e instanceof Error ? e.message : String(e)),
    );
  }
}

export interface VerificationMethod {
  id: string;
  type: string;
  publicKeyMultibase: string;
}

export type { AppPassword, DidDocument, InviteCodeInfo as InviteCode, Session };
export type { DidType, VerificationChannel };

function buildContactState(s: Record<string, unknown>): ContactState {
  const preferredChannel = s.preferredChannel as
    | VerificationChannel
    | undefined;
  const email = s.email ? unsafeAsEmail(s.email as string) : undefined;

  if (preferredChannel) {
    return {
      contactKind: "channel",
      preferredChannel,
      preferredChannelVerified: Boolean(s.preferredChannelVerified),
      email,
    };
  }

  if (email) {
    return {
      contactKind: "email",
      email,
      emailConfirmed: Boolean(s.emailConfirmed),
    };
  }

  return { contactKind: "none" };
}

function buildAccountState(s: Record<string, unknown>): AccountState {
  const status = s.status as string | undefined;
  const isAdmin = Boolean(s.isAdmin);
  const active = s.active as boolean | undefined;

  if (status === "migrated") {
    return {
      accountKind: "migrated",
      migratedToPds: (s.migratedToPds as string) || "",
      migratedAt: s.migratedAt
        ? unsafeAsISODate(s.migratedAt as string)
        : unsafeAsISODate(new Date().toISOString()),
      isAdmin,
    };
  }

  if (status === "deactivated" || active === false) {
    return { accountKind: "deactivated", isAdmin };
  }

  if (status === "suspended") {
    return { accountKind: "suspended", isAdmin };
  }

  return { accountKind: "active", isAdmin };
}

export function castSession(raw: unknown): Session {
  const s = raw as Record<string, unknown>;
  const contact = buildContactState(s);
  const account = buildAccountState(s);

  return {
    did: unsafeAsDid(s.did as string),
    handle: unsafeAsHandle(s.handle as string),
    accessJwt: unsafeAsAccessToken(s.accessJwt as string),
    refreshJwt: unsafeAsRefreshToken(s.refreshJwt as string),
    preferredLocale: s.preferredLocale as string | null | undefined,
    ...contact,
    ...account,
  };
}

function _castDelegationController(raw: unknown): DelegationController {
  const c = raw as Record<string, unknown>;
  return {
    did: unsafeAsDid(c.did as string),
    handle: c.handle ? unsafeAsHandle(c.handle as string) : undefined,
    grantedScopes: unsafeAsScopeSet(
      (c.granted_scopes ?? c.grantedScopes) as string,
    ),
    grantedAt: unsafeAsISODate(
      (c.granted_at ?? c.grantedAt ?? c.added_at) as string,
    ),
    isActive: (c.is_active ?? c.isActive ?? true) as boolean,
    isLocal: (c.is_local ?? c.isLocal ?? true) as boolean,
  };
}

function _castDelegationControlledAccount(
  raw: unknown,
): DelegationControlledAccount {
  const a = raw as Record<string, unknown>;
  return {
    did: unsafeAsDid(a.did as string),
    handle: a.handle ? unsafeAsHandle(a.handle as string) : undefined,
    grantedScopes: unsafeAsScopeSet(
      (a.granted_scopes ?? a.grantedScopes) as string,
    ),
    grantedAt: unsafeAsISODate(
      (a.granted_at ?? a.grantedAt ?? a.added_at) as string,
    ),
  };
}

function _castDelegationAuditEntry(raw: unknown): DelegationAuditEntry {
  const e = raw as Record<string, unknown>;
  const actorDid = (e.actor_did ?? e.actorDid) as string;
  const targetDid = (e.target_did ?? e.targetDid ?? e.delegatedDid) as
    | string
    | undefined;
  const createdAt = (e.created_at ?? e.createdAt) as string;
  const action = (e.action ?? e.actionType) as string;
  const details = e.details ?? e.actionDetails;
  const detailsStr = details
    ? (typeof details === "string" ? details : JSON.stringify(details))
    : undefined;
  return {
    id: e.id as string,
    action,
    actor_did: unsafeAsDid(actorDid),
    target_did: targetDid ? unsafeAsDid(targetDid) : undefined,
    details: detailsStr,
    created_at: unsafeAsISODate(createdAt),
  };
}

function _castSsoLinkedAccount(raw: unknown): SsoLinkedAccount {
  const a = raw as Record<string, unknown>;
  return {
    id: a.id as string,
    provider: a.provider as string,
    provider_name: a.provider_name as string,
    provider_username: a.provider_username as string,
    provider_email: a.provider_email as string | undefined,
    created_at: unsafeAsISODate(a.created_at as string),
    last_login_at: a.last_login_at
      ? unsafeAsISODate(a.last_login_at as string)
      : undefined,
  };
}

export const api = {
  async createAccount(
    params: CreateAccountParams,
    byodToken?: string,
  ): Promise<CreateAccountResult> {
    const url = `${API_BASE}/com.atproto.server.createAccount`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (byodToken) {
      headers["Authorization"] = `Bearer ${byodToken}`;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        handle: params.handle,
        email: params.email,
        password: params.password,
        inviteCode: params.inviteCode,
        didType: params.didType,
        did: params.did,
        signingKey: params.signingKey,
        verificationChannel: params.verificationChannel,
        discordUsername: params.discordUsername,
        telegramUsername: params.telegramUsername,
        signalUsername: params.signalUsername,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(response.status, data.error, data.message);
    }
    return data;
  },

  async createAccountWithServiceAuth(
    serviceAuthToken: string,
    params: {
      did: Did;
      handle: Handle;
      email?: EmailAddress;
      password: string;
      inviteCode?: string;
      verificationChannel?: string;
      discordUsername?: string;
      telegramUsername?: string;
      signalUsername?: string;
    },
  ): Promise<Session> {
    const url = `${API_BASE}/com.atproto.server.createAccount`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceAuthToken}`,
      },
      body: JSON.stringify({
        did: params.did,
        handle: params.handle,
        email: params.email,
        password: params.password,
        inviteCode: params.inviteCode,
        verificationChannel: params.verificationChannel,
        discordUsername: params.discordUsername,
        telegramUsername: params.telegramUsername,
        signalUsername: params.signalUsername,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(response.status, data.error, data.message);
    }
    return castSession(data);
  },

  confirmSignup(
    did: Did,
    verificationCode: string,
  ): Promise<ConfirmSignupResult> {
    return xrpc("com.atproto.server.confirmSignup", {
      method: "POST",
      body: { did, verificationCode },
    });
  },

  resendVerification(did: Did): Promise<{ success: boolean }> {
    return xrpc("com.atproto.server.resendVerification", {
      method: "POST",
      body: { did },
    });
  },

  async createSession(identifier: string, password: string): Promise<Session> {
    const raw = await xrpc<unknown>("com.atproto.server.createSession", {
      method: "POST",
      body: { identifier, password },
    });
    return castSession(raw);
  },

  checkEmailVerified(identifier: string): Promise<{ verified: boolean }> {
    return xrpc("_checkEmailVerified", {
      method: "POST",
      body: { identifier },
    });
  },

  checkChannelVerified(
    did: string,
    channel: string,
  ): Promise<{ verified: boolean }> {
    return xrpc("_checkChannelVerified", {
      method: "POST",
      body: { did, channel },
    });
  },

  checkEmailInUse(email: string): Promise<{ inUse: boolean }> {
    return xrpc("_account.checkEmailInUse", {
      method: "POST",
      body: { email },
    });
  },


  async getSession(token: AccessToken): Promise<Session> {
    const raw = await xrpc<unknown>("com.atproto.server.getSession", { token });
    return castSession(raw);
  },

  async refreshSession(refreshJwt: RefreshToken): Promise<Session> {
    const raw = await xrpc<unknown>("com.atproto.server.refreshSession", {
      method: "POST",
      token: refreshJwt,
    });
    return castSession(raw);
  },

  async deleteSession(token: AccessToken): Promise<void> {
    await xrpc("com.atproto.server.deleteSession", {
      method: "POST",
      token,
    });
  },

  listAppPasswords(token: AccessToken): Promise<{ passwords: AppPassword[] }> {
    return xrpc("com.atproto.server.listAppPasswords", { token });
  },

  createAppPassword(
    token: AccessToken,
    name: string,
    scopes?: string,
  ): Promise<CreatedAppPassword> {
    return xrpc("com.atproto.server.createAppPassword", {
      method: "POST",
      token,
      body: { name, scopes },
    });
  },

  async revokeAppPassword(token: AccessToken, name: string): Promise<void> {
    await xrpc("com.atproto.server.revokeAppPassword", {
      method: "POST",
      token,
      body: { name },
    });
  },

  getAccountInviteCodes(
    token: AccessToken,
  ): Promise<{ codes: InviteCodeInfo[] }> {
    return xrpc("com.atproto.server.getAccountInviteCodes", { token });
  },

  createInviteCode(
    token: AccessToken,
    useCount: number = 1,
  ): Promise<{ code: string }> {
    return xrpc("com.atproto.server.createInviteCode", {
      method: "POST",
      token,
      body: { useCount },
    });
  },

  async requestPasswordReset(email: EmailAddress): Promise<void> {
    await xrpc("com.atproto.server.requestPasswordReset", {
      method: "POST",
      body: { email },
    });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await xrpc("com.atproto.server.resetPassword", {
      method: "POST",
      body: { token, password },
    });
  },

  requestEmailUpdate(
    token: AccessToken,
    newEmail?: string,
  ): Promise<EmailUpdateResponse> {
    return xrpc("com.atproto.server.requestEmailUpdate", {
      method: "POST",
      token,
      body: newEmail ? { newEmail } : undefined,
    });
  },

  async updateEmail(
    token: AccessToken,
    email: string,
    emailToken?: string,
  ): Promise<void> {
    await xrpc("com.atproto.server.updateEmail", {
      method: "POST",
      token,
      body: { email, token: emailToken },
    });
  },

  checkEmailUpdateStatus(
    token: AccessToken,
  ): Promise<{ pending: boolean; authorized: boolean; newEmail?: string }> {
    return xrpc("_account.checkEmailUpdateStatus", {
      method: "GET",
      token,
    });
  },

  async updateHandle(token: AccessToken, handle: Handle): Promise<void> {
    await xrpc("com.atproto.identity.updateHandle", {
      method: "POST",
      token,
      body: { handle },
    });
  },

  async requestAccountDelete(token: AccessToken): Promise<void> {
    await xrpc("com.atproto.server.requestAccountDelete", {
      method: "POST",
      token,
    });
  },

  async deleteAccount(
    did: Did,
    password: string,
    deleteToken: string,
  ): Promise<void> {
    await xrpc("com.atproto.server.deleteAccount", {
      method: "POST",
      body: { did, password, token: deleteToken },
    });
  },

  describeServer(): Promise<ServerDescription> {
    return xrpc("com.atproto.server.describeServer");
  },

  listRepos(limit?: number): Promise<ListReposResponse> {
    const params: Record<string, string> = {};
    if (limit) params.limit = String(limit);
    return xrpc("com.atproto.sync.listRepos", { params });
  },

  getNotificationPrefs(token: AccessToken): Promise<NotificationPrefs> {
    return xrpc("_account.getNotificationPrefs", { token });
  },

  updateNotificationPrefs(token: AccessToken, prefs: {
    preferredChannel?: string;
    discordUsername?: string;
    telegramUsername?: string;
    signalUsername?: string;
  }): Promise<UpdateNotificationPrefsResponse> {
    return xrpc("_account.updateNotificationPrefs", {
      method: "POST",
      token,
      body: prefs,
    });
  },

  confirmChannelVerification(
    token: AccessToken,
    channel: string,
    identifier: string,
    code: string,
  ): Promise<SuccessResponse> {
    return xrpc("_account.confirmChannelVerification", {
      method: "POST",
      token,
      body: { channel, identifier, code },
    });
  },

  getNotificationHistory(
    token: AccessToken,
  ): Promise<NotificationHistoryResponse> {
    return xrpc("_account.getNotificationHistory", { token });
  },

  getServerStats(token: AccessToken): Promise<ServerStats> {
    return xrpc("_admin.getServerStats", { token });
  },

  getSignalStatus(token: AccessToken): Promise<SignalStatus> {
    return xrpc("_admin.getSignalStatus", { token });
  },

  linkSignalDevice(token: AccessToken): Promise<SignalLinkResult> {
    return xrpc("_admin.linkSignalDevice", { method: "POST", token });
  },

  unlinkSignalDevice(token: AccessToken): Promise<void> {
    return xrpc("_admin.unlinkSignalDevice", { method: "POST", token });
  },

  getServerConfig(): Promise<ServerConfig> {
    return xrpc("_server.getConfig");
  },

  updateServerConfig(
    token: AccessToken,
    config: {
      serverName?: string;
      primaryColor?: string;
      primaryColorDark?: string;
      secondaryColor?: string;
      secondaryColorDark?: string;
      logoCid?: string;
    },
  ): Promise<SuccessResponse> {
    return xrpc("_admin.updateServerConfig", {
      method: "POST",
      token,
      body: config,
    });
  },

  async uploadBlob(
    token: AccessToken,
    file: File,
  ): Promise<UploadBlobResponse> {
    const res = await authenticatedFetch("/xrpc/com.atproto.repo.uploadBlob", {
      method: "POST",
      token,
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      throw new ApiError(res.status, errData.error, errData.message);
    }
    return res.json();
  },

  async changePassword(
    token: AccessToken,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await xrpc("_account.changePassword", {
      method: "POST",
      token,
      body: { currentPassword, newPassword },
    });
  },

  removePassword(token: AccessToken): Promise<SuccessResponse> {
    return xrpc("_account.removePassword", {
      method: "POST",
      token,
    });
  },

  setPassword(
    token: AccessToken,
    newPassword: string,
  ): Promise<SuccessResponse> {
    return xrpc("_account.setPassword", {
      method: "POST",
      token,
      body: { newPassword },
    });
  },

  getPasswordStatus(token: AccessToken): Promise<PasswordStatus> {
    return xrpc("_account.getPasswordStatus", { token });
  },

  getLegacyLoginPreference(token: AccessToken): Promise<LegacyLoginPreference> {
    return xrpc("_account.getLegacyLoginPreference", { token });
  },

  updateLegacyLoginPreference(
    token: AccessToken,
    allowLegacyLogin: boolean,
  ): Promise<UpdateLegacyLoginResponse> {
    return xrpc("_account.updateLegacyLoginPreference", {
      method: "POST",
      token,
      body: { allowLegacyLogin },
    });
  },

  updateLocale(
    token: AccessToken,
    preferredLocale: string,
  ): Promise<UpdateLocaleResponse> {
    return xrpc("_account.updateLocale", {
      method: "POST",
      token,
      body: { preferredLocale },
    });
  },

  listSessions(token: AccessToken): Promise<ListSessionsResponse> {
    return xrpc("_account.listSessions", { token });
  },

  async revokeSession(token: AccessToken, sessionId: string): Promise<void> {
    await xrpc("_account.revokeSession", {
      method: "POST",
      token,
      body: { sessionId },
    });
  },

  revokeAllSessions(token: AccessToken): Promise<{ revokedCount: number }> {
    return xrpc("_account.revokeAllSessions", {
      method: "POST",
      token,
    });
  },

  searchAccounts(token: AccessToken, options?: {
    handle?: string;
    cursor?: string;
    limit?: number;
  }): Promise<SearchAccountsResponse> {
    const params: Record<string, string> = {};
    if (options?.handle) params.handle = options.handle;
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.limit) params.limit = String(options.limit);
    return xrpc("com.atproto.admin.searchAccounts", { token, params });
  },

  getInviteCodes(token: AccessToken, options?: {
    sort?: "recent" | "usage";
    cursor?: string;
    limit?: number;
  }): Promise<GetInviteCodesResponse> {
    const params: Record<string, string> = {};
    if (options?.sort) params.sort = options.sort;
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.limit) params.limit = String(options.limit);
    return xrpc("com.atproto.admin.getInviteCodes", { token, params });
  },

  async disableInviteCodes(
    token: AccessToken,
    codes?: string[],
    accounts?: string[],
  ): Promise<void> {
    await xrpc("com.atproto.admin.disableInviteCodes", {
      method: "POST",
      token,
      body: { codes, accounts },
    });
  },

  getAccountInfo(token: AccessToken, did: Did): Promise<AccountInfo> {
    return xrpc("com.atproto.admin.getAccountInfo", { token, params: { did } });
  },

  async disableAccountInvites(token: AccessToken, account: Did): Promise<void> {
    await xrpc("com.atproto.admin.disableAccountInvites", {
      method: "POST",
      token,
      body: { account },
    });
  },

  async enableAccountInvites(token: AccessToken, account: Did): Promise<void> {
    await xrpc("com.atproto.admin.enableAccountInvites", {
      method: "POST",
      token,
      body: { account },
    });
  },

  async adminDeleteAccount(token: AccessToken, did: Did): Promise<void> {
    await xrpc("com.atproto.admin.deleteAccount", {
      method: "POST",
      token,
      body: { did },
    });
  },

  describeRepo(token: AccessToken, repo: Did): Promise<RepoDescription> {
    return xrpc("com.atproto.repo.describeRepo", {
      token,
      params: { repo },
    });
  },

  listRecords(token: AccessToken, repo: Did, collection: Nsid, options?: {
    limit?: number;
    cursor?: string;
    reverse?: boolean;
  }): Promise<ListRecordsResponse> {
    const params: Record<string, string> = { repo, collection };
    if (options?.limit) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.reverse) params.reverse = "true";
    return xrpc("com.atproto.repo.listRecords", { token, params });
  },

  getRecord(
    token: AccessToken,
    repo: Did,
    collection: Nsid,
    rkey: Rkey,
  ): Promise<RecordResponse> {
    return xrpc("com.atproto.repo.getRecord", {
      token,
      params: { repo, collection, rkey },
    });
  },

  createRecord(
    token: AccessToken,
    repo: Did,
    collection: Nsid,
    record: unknown,
    rkey?: Rkey,
  ): Promise<CreateRecordResponse> {
    return xrpc("com.atproto.repo.createRecord", {
      method: "POST",
      token,
      body: { repo, collection, record, rkey },
    });
  },

  putRecord(
    token: AccessToken,
    repo: Did,
    collection: Nsid,
    rkey: Rkey,
    record: unknown,
  ): Promise<CreateRecordResponse> {
    return xrpc("com.atproto.repo.putRecord", {
      method: "POST",
      token,
      body: { repo, collection, rkey, record },
    });
  },

  async deleteRecord(
    token: AccessToken,
    repo: Did,
    collection: Nsid,
    rkey: Rkey,
  ): Promise<void> {
    await xrpc("com.atproto.repo.deleteRecord", {
      method: "POST",
      token,
      body: { repo, collection, rkey },
    });
  },

  getTotpStatus(token: AccessToken): Promise<TotpStatus> {
    return xrpc("com.atproto.server.getTotpStatus", { token });
  },

  createTotpSecret(token: AccessToken): Promise<TotpSecret> {
    return xrpc("com.atproto.server.createTotpSecret", {
      method: "POST",
      token,
    });
  },

  enableTotp(token: AccessToken, code: string): Promise<EnableTotpResponse> {
    return xrpc("com.atproto.server.enableTotp", {
      method: "POST",
      token,
      body: { code },
    });
  },

  disableTotp(
    token: AccessToken,
    password: string,
    code: string,
  ): Promise<SuccessResponse> {
    return xrpc("com.atproto.server.disableTotp", {
      method: "POST",
      token,
      body: { password, code },
    });
  },

  regenerateBackupCodes(
    token: AccessToken,
    password: string,
    code: string,
  ): Promise<RegenerateBackupCodesResponse> {
    return xrpc("com.atproto.server.regenerateBackupCodes", {
      method: "POST",
      token,
      body: { password, code },
    });
  },

  startPasskeyRegistration(
    token: AccessToken,
    friendlyName?: string,
  ): Promise<StartPasskeyRegistrationResponse> {
    return xrpc("com.atproto.server.startPasskeyRegistration", {
      method: "POST",
      token,
      body: { friendlyName },
    });
  },

  finishPasskeyRegistration(
    token: AccessToken,
    credential: unknown,
    friendlyName?: string,
  ): Promise<FinishPasskeyRegistrationResponse> {
    return xrpc("com.atproto.server.finishPasskeyRegistration", {
      method: "POST",
      token,
      body: { credential, friendlyName },
    });
  },

  listPasskeys(token: AccessToken): Promise<ListPasskeysResponse> {
    return xrpc("com.atproto.server.listPasskeys", { token });
  },

  async deletePasskey(token: AccessToken, id: string): Promise<void> {
    await xrpc("com.atproto.server.deletePasskey", {
      method: "POST",
      token,
      body: { id },
    });
  },

  async updatePasskey(
    token: AccessToken,
    id: string,
    friendlyName: string,
  ): Promise<void> {
    await xrpc("com.atproto.server.updatePasskey", {
      method: "POST",
      token,
      body: { id, friendlyName },
    });
  },

  listTrustedDevices(token: AccessToken): Promise<ListTrustedDevicesResponse> {
    return xrpc("_account.listTrustedDevices", { token });
  },

  revokeTrustedDevice(
    token: AccessToken,
    deviceId: string,
  ): Promise<SuccessResponse> {
    return xrpc("_account.revokeTrustedDevice", {
      method: "POST",
      token,
      body: { deviceId },
    });
  },

  updateTrustedDevice(
    token: AccessToken,
    deviceId: string,
    friendlyName: string,
  ): Promise<SuccessResponse> {
    return xrpc("_account.updateTrustedDevice", {
      method: "POST",
      token,
      body: { deviceId, friendlyName },
    });
  },

  getReauthStatus(token: AccessToken): Promise<ReauthStatus> {
    return xrpc("_account.getReauthStatus", { token });
  },

  reauthPassword(
    token: AccessToken,
    password: string,
  ): Promise<ReauthResponse> {
    return xrpc("_account.reauthPassword", {
      method: "POST",
      token,
      body: { password },
    });
  },

  reauthTotp(token: AccessToken, code: string): Promise<ReauthResponse> {
    return xrpc("_account.reauthTotp", {
      method: "POST",
      token,
      body: { code },
    });
  },

  reauthPasskeyStart(token: AccessToken): Promise<ReauthPasskeyStartResponse> {
    return xrpc("_account.reauthPasskeyStart", {
      method: "POST",
      token,
    });
  },

  reauthPasskeyFinish(
    token: AccessToken,
    credential: unknown,
  ): Promise<ReauthResponse> {
    return xrpc("_account.reauthPasskeyFinish", {
      method: "POST",
      token,
      body: { credential },
    });
  },

  reserveSigningKey(did?: Did): Promise<ReserveSigningKeyResponse> {
    return xrpc("com.atproto.server.reserveSigningKey", {
      method: "POST",
      body: { did },
    });
  },

  getRecommendedDidCredentials(
    token: AccessToken,
  ): Promise<RecommendedDidCredentials> {
    return xrpc("com.atproto.identity.getRecommendedDidCredentials", { token });
  },

  async activateAccount(token: AccessToken): Promise<void> {
    await xrpc("com.atproto.server.activateAccount", {
      method: "POST",
      token,
    });
  },

  async createPasskeyAccount(params: {
    handle: Handle;
    email?: EmailAddress;
    inviteCode?: string;
    didType?: DidType;
    did?: Did;
    signingKey?: string;
    verificationChannel?: VerificationChannel;
    discordUsername?: string;
    telegramUsername?: string;
    signalUsername?: string;
  }, byodToken?: string): Promise<PasskeyAccountCreateResponse> {
    const url = `${API_BASE}/_account.createPasskeyAccount`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (byodToken) {
      headers["Authorization"] = `Bearer ${byodToken}`;
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      throw new ApiError(res.status, errData.error, errData.message);
    }
    return res.json();
  },

  startPasskeyRegistrationForSetup(
    did: Did,
    setupToken: string,
    friendlyName?: string,
  ): Promise<StartPasskeyRegistrationResponse> {
    return xrpc("_account.startPasskeyRegistrationForSetup", {
      method: "POST",
      body: { did, setupToken, friendlyName },
    });
  },

  completePasskeySetup(
    did: Did,
    setupToken: string,
    passkeyCredential: unknown,
    passkeyFriendlyName?: string,
  ): Promise<CompletePasskeySetupResponse> {
    return xrpc("_account.completePasskeySetup", {
      method: "POST",
      body: { did, setupToken, passkeyCredential, passkeyFriendlyName },
    });
  },

  requestPasskeyRecovery(email: EmailAddress): Promise<SuccessResponse> {
    return xrpc("_account.requestPasskeyRecovery", {
      method: "POST",
      body: { email },
    });
  },

  recoverPasskeyAccount(
    did: Did,
    recoveryToken: string,
    newPassword: string,
  ): Promise<SuccessResponse> {
    return xrpc("_account.recoverPasskeyAccount", {
      method: "POST",
      body: { did, recoveryToken, newPassword },
    });
  },

  verifyMigrationEmail(
    token: string,
    email: EmailAddress,
  ): Promise<VerifyMigrationEmailResponse> {
    return xrpc("com.atproto.server.verifyMigrationEmail", {
      method: "POST",
      body: { token, email },
    });
  },

  resendMigrationVerification(
    channel: string,
    identifier: string,
  ): Promise<ResendMigrationVerificationResponse> {
    return xrpc("com.atproto.server.resendMigrationVerification", {
      method: "POST",
      body: { channel, identifier },
    });
  },

  verifyToken(
    token: string,
    identifier: string,
    accessToken?: AccessToken,
  ): Promise<VerifyTokenResponse> {
    return xrpc("_account.verifyToken", {
      method: "POST",
      body: { token, identifier },
      token: accessToken,
    });
  },

  getDidDocument(token: AccessToken): Promise<DidDocument> {
    return xrpc("_account.getDidDocument", { token });
  },

  updateDidDocument(
    token: AccessToken,
    params: {
      verificationMethods?: VerificationMethod[];
      alsoKnownAs?: string[];
      serviceEndpoint?: string;
    },
  ): Promise<SuccessResponse> {
    return xrpc("_account.updateDidDocument", {
      method: "POST",
      token,
      body: params,
    });
  },

  async deactivateAccount(
    token: AccessToken,
    deleteAfter?: string,
  ): Promise<void> {
    await xrpc("com.atproto.server.deactivateAccount", {
      method: "POST",
      token,
      body: { deleteAfter },
    });
  },

  async getRepo(token: AccessToken, did: Did): Promise<ArrayBuffer> {
    const url = `${API_BASE}/com.atproto.sync.getRepo?did=${
      encodeURIComponent(did)
    }`;
    const res = await authenticatedFetch(url, { token });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      throw new ApiError(res.status, errData.error, errData.message);
    }
    return res.arrayBuffer();
  },

  async importRepo(token: AccessToken, car: Uint8Array): Promise<void> {
    const res = await authenticatedFetch(
      `${API_BASE}/com.atproto.repo.importRepo`,
      {
        method: "POST",
        token,
        headers: { "Content-Type": "application/vnd.ipld.car" },
        body: car as unknown as BodyInit,
      },
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      throw new ApiError(res.status, errData.error, errData.message);
    }
  },

  async establishOAuthSession(
    token: AccessToken,
  ): Promise<{ success: boolean; device_id: string }> {
    const res = await authenticatedFetch("/oauth/establish-session", {
      method: "POST",
      token,
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      throw new ApiError(res.status, errData.error, errData.message);
    }
    return res.json();
  },

  async getSsoLinkedAccounts(
    token: AccessToken,
  ): Promise<{ accounts: SsoLinkedAccount[] }> {
    const res = await authenticatedFetch("/oauth/sso/linked", { token });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      throw new ApiError(res.status, errData.error, errData.message);
    }
    return res.json();
  },

  async initiateSsoLink(
    token: AccessToken,
    provider: string,
    requestUri: string,
  ): Promise<{ redirect_url: string }> {
    const res = await authenticatedFetch("/oauth/sso/initiate", {
      method: "POST",
      token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        request_uri: requestUri,
        action: "link",
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      throw new ApiError(
        res.status,
        errData.error,
        errData.error_description ?? errData.message,
        errData.reauthMethods,
      );
    }
    return res.json();
  },

  async unlinkSsoAccount(
    token: AccessToken,
    id: string,
  ): Promise<{ success: boolean }> {
    const res = await authenticatedFetch("/oauth/sso/unlink", {
      method: "POST",
      token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({
        error: "Unknown",
        message: res.statusText,
      }));
      throw new ApiError(
        res.status,
        errData.error,
        errData.error_description ?? errData.message,
        errData.reauthMethods,
      );
    }
    return res.json();
  },

  async listDelegationControllers(
    token: AccessToken,
  ): Promise<Result<{ controllers: DelegationController[] }, ApiError>> {
    const result = await xrpcResult<{ controllers: unknown[] }>(
      "_delegation.listControllers",
      { token },
    );
    if (!result.ok) return result;
    return ok({
      controllers: (result.value.controllers ?? []).map(
        _castDelegationController,
      ),
    });
  },

  async listDelegationControlledAccounts(
    token: AccessToken,
  ): Promise<Result<{ accounts: DelegationControlledAccount[] }, ApiError>> {
    const result = await xrpcResult<{ accounts: unknown[] }>(
      "_delegation.listControlledAccounts",
      { token },
    );
    if (!result.ok) return result;
    return ok({
      accounts: (result.value.accounts ?? []).map(
        _castDelegationControlledAccount,
      ),
    });
  },

  getDelegationScopePresets(): Promise<
    Result<{ presets: DelegationScopePreset[] }, ApiError>
  > {
    return xrpcResult("_delegation.getScopePresets");
  },

  resolveController(
    identifier: string,
  ): Promise<
    Result<
      { did: string; handle?: string; pdsUrl?: string; isLocal: boolean },
      ApiError
    >
  > {
    return xrpcResult("_delegation.resolveController", {
      params: { identifier },
    });
  },

  addDelegationController(
    token: AccessToken,
    controllerDid: Did,
    grantedScopes: ScopeSet,
  ): Promise<Result<{ success: boolean }, ApiError>> {
    return xrpcResult("_delegation.addController", {
      method: "POST",
      token,
      body: { controller_did: controllerDid, granted_scopes: grantedScopes },
    });
  },

  removeDelegationController(
    token: AccessToken,
    controllerDid: Did,
  ): Promise<Result<{ success: boolean }, ApiError>> {
    return xrpcResult("_delegation.removeController", {
      method: "POST",
      token,
      body: { controller_did: controllerDid },
    });
  },

  createDelegatedAccount(
    token: AccessToken,
    handle: Handle,
    email?: EmailAddress,
    controllerScopes?: ScopeSet,
  ): Promise<Result<{ did: Did; handle: Handle }, ApiError>> {
    return xrpcResult("_delegation.createDelegatedAccount", {
      method: "POST",
      token,
      body: { handle, email, controllerScopes },
    });
  },

  async getDelegationAuditLog(
    token: AccessToken,
    limit: number,
    offset: number,
  ): Promise<
    Result<{ entries: DelegationAuditEntry[]; total: number }, ApiError>
  > {
    const result = await xrpcResult<{ entries: unknown[]; total: number }>(
      "_delegation.getAuditLog",
      {
        token,
        params: { limit: String(limit), offset: String(offset) },
      },
    );
    if (!result.ok) return result;
    return ok({
      entries: (result.value.entries ?? []).map(_castDelegationAuditEntry),
      total: result.value.total ?? 0,
    });
  },

};
