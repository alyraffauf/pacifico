import { Client } from "@atcute/client";
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
  ApiError,
  mainApiTransport,
  setTokenRefreshCallback,
  type RawRequestOptions,
} from "./api-transport.ts";
import type {
  AccountInfo,
  AccountState,
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
  const headers = body ? { "Content-Type": "application/json" } : undefined;
  const transportOptions: RawRequestOptions = {
    method: httpMethod,
    params,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    authentication: token
      ? { type: "refreshable-dpop", token: token as AccessToken }
      : { type: "none" },
    retryExpiredToken: !skipRetry,
    retryNonce: !skipDpopRetry,
  };
  return mainApiTransport.requestXrpc<T>(method, transportOptions);
}

type AtcuteResponse =
  | { ok: true; status: number; headers: Headers; data: unknown }
  | { ok: false; status: number; headers: Headers; data: unknown };

const client = new Client({ handler: mainApiTransport.handleAtcuteFetch });
const noRefreshClient = new Client({
  handler: mainApiTransport.handleAtcuteFetchWithoutRefresh,
});

async function unwrapAtcute<T>(request: Promise<AtcuteResponse>): Promise<T> {
  const response = await request;
  if (!response.ok) {
    throw mainApiTransport.createApiErrorFromData(
      response.status,
      response.data,
    );
  }
  return response.data as T;
}

function withToken(token: AccessToken | RefreshToken): HeadersInit {
  return { Authorization: `DPoP ${token}` };
}

const asAtcuteDid = (did: Did): `did:${string}:${string}` =>
  did as `did:${string}:${string}`;
const asAtcuteHandle = (handle: string): `${string}.${string}` =>
  handle as `${string}.${string}`;
const asAtcuteNsid = (nsid: Nsid): `${string}.${string}.${string}` =>
  nsid as `${string}.${string}.${string}`;
const asAtcuteRkey = (rkey: Rkey): string => rkey;

export { ApiError, setTokenRefreshCallback };

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
    VerificationChannel | undefined;
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

export async function getSessionWithoutRefresh(
  token: AccessToken,
): Promise<Session> {
  const raw = await unwrapAtcute<unknown>(
    noRefreshClient.get("com.atproto.server.getSession", {
      headers: withToken(token),
    }),
  );
  return castSession(raw);
}

function castDelegationController(raw: unknown): DelegationController {
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

function castDelegationControlledAccount(
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

function castDelegationAuditEntry(raw: unknown): DelegationAuditEntry {
  const e = raw as Record<string, unknown>;
  const actorDid = (e.actor_did ?? e.actorDid) as string;
  const targetDid = (e.target_did ?? e.targetDid ?? e.delegatedDid) as
    string | undefined;
  const createdAt = (e.created_at ?? e.createdAt) as string;
  const action = (e.action ?? e.actionType) as string;
  const details = e.details ?? e.actionDetails;
  const detailsStr = details
    ? typeof details === "string"
      ? details
      : JSON.stringify(details)
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

export const api = {
  async createAccount(
    params: CreateAccountParams,
    byodToken?: string,
  ): Promise<CreateAccountResult> {
    return mainApiTransport.requestXrpc("com.atproto.server.createAccount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      authentication: byodToken
        ? { type: "bearer", token: byodToken }
        : { type: "none" },
    });
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
    const data = await mainApiTransport.requestXrpc<unknown>(
      "com.atproto.server.createAccount",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        authentication: { type: "bearer", token: serviceAuthToken },
      },
    );
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
    const raw = await unwrapAtcute<unknown>(
      client.post("com.atproto.server.createSession", {
        input: { identifier, password },
      }),
    );
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
    const raw = await unwrapAtcute<unknown>(
      client.get("com.atproto.server.getSession", {
        headers: withToken(token),
      }),
    );
    return castSession(raw);
  },

  async refreshSession(refreshJwt: RefreshToken): Promise<Session> {
    const raw = await unwrapAtcute<unknown>(
      noRefreshClient.post("com.atproto.server.refreshSession", {
        headers: withToken(refreshJwt),
      }),
    );
    return castSession(raw);
  },

  async deleteSession(token: AccessToken): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.server.deleteSession", {
        headers: withToken(token),
        as: null,
      }),
    );
  },

  listAppPasswords(token: AccessToken): Promise<{ passwords: AppPassword[] }> {
    return unwrapAtcute(
      client.get("com.atproto.server.listAppPasswords", {
        headers: withToken(token),
      }),
    );
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
    await unwrapAtcute(
      client.post("com.atproto.server.revokeAppPassword", {
        headers: withToken(token),
        input: { name },
        as: null,
      }),
    );
  },

  getAccountInviteCodes(
    token: AccessToken,
  ): Promise<{ codes: InviteCodeInfo[] }> {
    return unwrapAtcute(
      client.get("com.atproto.server.getAccountInviteCodes", {
        headers: withToken(token),
        params: {},
      }),
    );
  },

  createInviteCode(
    token: AccessToken,
    useCount: number = 1,
  ): Promise<{ code: string }> {
    return unwrapAtcute(
      client.post("com.atproto.server.createInviteCode", {
        headers: withToken(token),
        input: { useCount },
      }),
    );
  },

  async requestPasswordReset(email: EmailAddress): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.server.requestPasswordReset", {
        input: { email },
        as: null,
      }),
    );
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.server.resetPassword", {
        input: { token, password },
        as: null,
      }),
    );
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
    await unwrapAtcute(
      client.post("com.atproto.server.updateEmail", {
        headers: withToken(token),
        input: { email, token: emailToken },
        as: null,
      }),
    );
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
    await unwrapAtcute(
      client.post("com.atproto.identity.updateHandle", {
        headers: withToken(token),
        input: { handle: asAtcuteHandle(handle) },
        as: null,
      }),
    );
  },

  async requestAccountDelete(token: AccessToken): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.server.requestAccountDelete", {
        headers: withToken(token),
        as: null,
      }),
    );
  },

  async deleteAccount(
    did: Did,
    password: string,
    deleteToken: string,
  ): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.server.deleteAccount", {
        input: { did: asAtcuteDid(did), password, token: deleteToken },
        as: null,
      }),
    );
  },

  describeServer(): Promise<ServerDescription> {
    return unwrapAtcute(client.get("com.atproto.server.describeServer"));
  },

  listRepos(limit?: number): Promise<ListReposResponse> {
    return unwrapAtcute(
      client.get("com.atproto.sync.listRepos", { params: { limit } }),
    );
  },

  getNotificationPrefs(token: AccessToken): Promise<NotificationPrefs> {
    return xrpc("_account.getNotificationPrefs", { token });
  },

  updateNotificationPrefs(
    token: AccessToken,
    prefs: {
      preferredChannel?: string;
      discordUsername?: string;
      telegramUsername?: string;
      signalUsername?: string;
    },
  ): Promise<UpdateNotificationPrefsResponse> {
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
    return unwrapAtcute(
      client.post("com.atproto.repo.uploadBlob", {
        headers: { ...withToken(token), "Content-Type": file.type },
        input: file,
      }),
    );
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

  searchAccounts(
    token: AccessToken,
    options?: {
      handle?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<SearchAccountsResponse> {
    const params: Record<string, string> = {};
    if (options?.handle) params.handle = options.handle;
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.limit) params.limit = String(options.limit);
    return xrpc("com.atproto.admin.searchAccounts", { token, params });
  },

  getInviteCodes(
    token: AccessToken,
    options?: {
      sort?: "recent" | "usage";
      cursor?: string;
      limit?: number;
    },
  ): Promise<GetInviteCodesResponse> {
    return unwrapAtcute(
      client.get("com.atproto.admin.getInviteCodes", {
        headers: withToken(token),
        params: {
          sort: options?.sort,
          cursor: options?.cursor,
          limit: options?.limit,
        },
      }),
    );
  },

  async disableInviteCodes(
    token: AccessToken,
    codes?: string[],
    accounts?: string[],
  ): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.admin.disableInviteCodes", {
        headers: withToken(token),
        input: {
          codes,
          accounts: accounts?.map((did) => asAtcuteDid(unsafeAsDid(did))),
        },
        as: null,
      }),
    );
  },

  getAccountInfo(token: AccessToken, did: Did): Promise<AccountInfo> {
    return unwrapAtcute(
      client.get("com.atproto.admin.getAccountInfo", {
        headers: withToken(token),
        params: { did: asAtcuteDid(did) },
      }),
    );
  },

  async disableAccountInvites(token: AccessToken, account: Did): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.admin.disableAccountInvites", {
        headers: withToken(token),
        input: { account: asAtcuteDid(account) },
        as: null,
      }),
    );
  },

  async enableAccountInvites(token: AccessToken, account: Did): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.admin.enableAccountInvites", {
        headers: withToken(token),
        input: { account: asAtcuteDid(account) },
        as: null,
      }),
    );
  },

  async adminDeleteAccount(token: AccessToken, did: Did): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.admin.deleteAccount", {
        headers: withToken(token),
        input: { did: asAtcuteDid(did) },
        as: null,
      }),
    );
  },

  describeRepo(token: AccessToken, repo: Did): Promise<RepoDescription> {
    return unwrapAtcute(
      client.get("com.atproto.repo.describeRepo", {
        headers: withToken(token),
        params: { repo: asAtcuteDid(repo) },
      }),
    );
  },

  listRecords(
    token: AccessToken,
    repo: Did,
    collection: Nsid,
    options?: {
      limit?: number;
      cursor?: string;
      reverse?: boolean;
    },
  ): Promise<ListRecordsResponse> {
    return unwrapAtcute(
      client.get("com.atproto.repo.listRecords", {
        headers: withToken(token),
        params: {
          repo: asAtcuteDid(repo),
          collection: asAtcuteNsid(collection),
          limit: options?.limit,
          cursor: options?.cursor,
          reverse: options?.reverse,
        },
      }),
    );
  },

  getRecord(
    token: AccessToken,
    repo: Did,
    collection: Nsid,
    rkey: Rkey,
  ): Promise<RecordResponse> {
    return unwrapAtcute(
      client.get("com.atproto.repo.getRecord", {
        headers: withToken(token),
        params: {
          repo: asAtcuteDid(repo),
          collection: asAtcuteNsid(collection),
          rkey: asAtcuteRkey(rkey),
        },
      }),
    );
  },

  createRecord(
    token: AccessToken,
    repo: Did,
    collection: Nsid,
    record: unknown,
    rkey?: Rkey,
  ): Promise<CreateRecordResponse> {
    return unwrapAtcute(
      client.post("com.atproto.repo.createRecord", {
        headers: withToken(token),
        input: {
          repo: asAtcuteDid(repo),
          collection: asAtcuteNsid(collection),
          record: record as Record<string, unknown>,
          rkey: rkey ? asAtcuteRkey(rkey) : undefined,
        },
      }),
    );
  },

  putRecord(
    token: AccessToken,
    repo: Did,
    collection: Nsid,
    rkey: Rkey,
    record: unknown,
  ): Promise<CreateRecordResponse> {
    return unwrapAtcute(
      client.post("com.atproto.repo.putRecord", {
        headers: withToken(token),
        input: {
          repo: asAtcuteDid(repo),
          collection: asAtcuteNsid(collection),
          rkey: asAtcuteRkey(rkey),
          record: record as Record<string, unknown>,
        },
      }),
    );
  },

  async deleteRecord(
    token: AccessToken,
    repo: Did,
    collection: Nsid,
    rkey: Rkey,
  ): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.repo.deleteRecord", {
        headers: withToken(token),
        input: {
          repo: asAtcuteDid(repo),
          collection: asAtcuteNsid(collection),
          rkey: asAtcuteRkey(rkey),
        },
        as: null,
      }),
    );
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
    return unwrapAtcute(
      client.post("com.atproto.server.reserveSigningKey", {
        input: { did: did ? asAtcuteDid(did) : undefined },
      }),
    );
  },

  getRecommendedDidCredentials(
    token: AccessToken,
  ): Promise<RecommendedDidCredentials> {
    return unwrapAtcute(
      client.get("com.atproto.identity.getRecommendedDidCredentials", {
        headers: withToken(token),
      }),
    );
  },

  async activateAccount(token: AccessToken): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.server.activateAccount", {
        headers: withToken(token),
        as: null,
      }),
    );
  },

  async createPasskeyAccount(
    params: {
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
    },
    byodToken?: string,
  ): Promise<PasskeyAccountCreateResponse> {
    return mainApiTransport.requestXrpc("_account.createPasskeyAccount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      authentication: byodToken
        ? { type: "bearer", token: byodToken }
        : { type: "none" },
    });
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
    await unwrapAtcute(
      client.post("com.atproto.server.deactivateAccount", {
        headers: withToken(token),
        input: { deleteAfter },
        as: null,
      }),
    );
  },

  resolveHandle(handle: string): Promise<{ did: Did }> {
    return unwrapAtcute(
      client.get("com.atproto.identity.resolveHandle", {
        params: { handle: asAtcuteHandle(handle) },
      }),
    );
  },

  async getRepo(token: AccessToken, did: Did): Promise<ArrayBuffer> {
    const bytes = await unwrapAtcute<Uint8Array>(
      client.get("com.atproto.sync.getRepo", {
        headers: withToken(token),
        params: { did: asAtcuteDid(did) },
        as: "bytes",
      }),
    );
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  },

  async importRepo(token: AccessToken, car: Uint8Array): Promise<void> {
    await unwrapAtcute(
      client.post("com.atproto.repo.importRepo", {
        headers: {
          ...withToken(token),
          "Content-Type": "application/vnd.ipld.car",
        },
        input: car,
        as: null,
      }),
    );
  },

  async establishOAuthSession(
    token: AccessToken,
  ): Promise<{ success: boolean; device_id: string }> {
    return mainApiTransport.requestJson("/oauth/establish-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      authentication: { type: "refreshable-dpop", token },
      retryNonce: false,
      retryExpiredToken: false,
    });
  },

  async getSsoLinkedAccounts(
    token: AccessToken,
  ): Promise<{ accounts: SsoLinkedAccount[] }> {
    return mainApiTransport.requestJson("/oauth/sso/linked", {
      authentication: { type: "refreshable-dpop", token },
      retryNonce: false,
      retryExpiredToken: false,
    });
  },

  async initiateSsoLink(
    token: AccessToken,
    provider: string,
    requestUri: string,
  ): Promise<{ redirect_url: string }> {
    return mainApiTransport.requestJson("/oauth/sso/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        request_uri: requestUri,
        action: "link",
      }),
      authentication: { type: "refreshable-dpop", token },
      retryNonce: false,
      retryExpiredToken: false,
    });
  },

  async unlinkSsoAccount(
    token: AccessToken,
    id: string,
  ): Promise<{ success: boolean }> {
    return mainApiTransport.requestJson("/oauth/sso/unlink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      authentication: { type: "refreshable-dpop", token },
      retryNonce: false,
      retryExpiredToken: false,
    });
  },

  async authorizeDelegatedSession(
    accessToken: AccessToken,
    requestUri: string,
    delegatedDid: Did,
  ): Promise<{ success: true; redirect_uri: string }> {
    const result = await mainApiTransport.requestJson<{
      success?: boolean;
      redirect_uri?: string;
      error?: string;
    }>("/oauth/delegation/auth-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_uri: requestUri,
        delegated_did: delegatedDid,
      }),
      authentication: { type: "dpop", token: accessToken },
      retryNonce: true,
      retryNonceOnAnyFailure: true,
      retryExpiredToken: false,
    });
    if (!result.success || !result.redirect_uri) {
      throw new Error(result.error ?? "Could not start delegated sign-in.");
    }
    return { success: true, redirect_uri: result.redirect_uri };
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
        castDelegationController,
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
        castDelegationControlledAccount,
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
      entries: (result.value.entries ?? []).map(castDelegationAuditEntry),
      total: result.value.total ?? 0,
    });
  },
};
