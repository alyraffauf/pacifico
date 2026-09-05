import type {
  AccessToken,
  AtUri,
  Cid,
  Did,
  EmailAddress,
  Handle,
  InviteCode as InviteCodeBrand,
  ISODateString,
  Nsid,
  PublicKeyMultibase,
  RefreshToken,
  ScopeSet,
} from "./branded.ts";

export type ApiErrorCode =
  | "InvalidRequest"
  | "AuthenticationRequired"
  | "ExpiredToken"
  | "InvalidToken"
  | "AccountNotFound"
  | "HandleNotAvailable"
  | "InvalidHandle"
  | "InvalidPassword"
  | "RateLimitExceeded"
  | "InternalServerError"
  | "AccountTakedown"
  | "AccountDeactivated"
  | "AccountNotVerified"
  | "RepoNotFound"
  | "RecordNotFound"
  | "BlobNotFound"
  | "InvalidInviteCode"
  | "DuplicateCreate"
  | "ReauthRequired"
  | "MfaVerificationRequired"
  | "RecoveryLinkExpired"
  | "InvalidRecoveryLink"
  | "Unknown";

export type AccountStatus =
  | "active"
  | "deactivated"
  | "migrated"
  | "suspended"
  | "deleted";

export type SessionType = "oauth" | "legacy" | "app_password";

export type VerificationChannel = "email" | "discord" | "telegram" | "signal";

export type DidType = "plc" | "web" | "web-external";

export type ReauthMethod = "password" | "totp" | "passkey";

export type ContactState =
  | {
    readonly contactKind: "channel";
    readonly preferredChannel: VerificationChannel;
    readonly preferredChannelVerified: boolean;
    readonly email?: EmailAddress;
  }
  | {
    readonly contactKind: "email";
    readonly email: EmailAddress;
    readonly emailConfirmed: boolean;
  }
  | { readonly contactKind: "none" };

export type AccountState =
  | { readonly accountKind: "active"; readonly isAdmin: boolean }
  | {
    readonly accountKind: "migrated";
    readonly migratedToPds: string;
    readonly migratedAt: ISODateString;
    readonly isAdmin: boolean;
  }
  | { readonly accountKind: "deactivated"; readonly isAdmin: boolean }
  | { readonly accountKind: "suspended"; readonly isAdmin: boolean };

type SessionBase = {
  readonly did: Did;
  readonly handle: Handle;
  readonly accessJwt: AccessToken;
  readonly refreshJwt: RefreshToken;
  readonly preferredLocale?: string | null;
};

export type Session = SessionBase & ContactState & AccountState;

export function getSessionEmail(session: Session): EmailAddress | undefined {
  return session.contactKind === "email"
    ? session.email
    : session.contactKind === "channel"
    ? session.email
    : undefined;
}

export function isActive(session: Session): boolean {
  return session.accountKind === "active";
}

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: PublicKeyMultibase;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export interface DidDocument {
  "@context": string[];
  id: Did;
  alsoKnownAs: string[];
  verificationMethod: VerificationMethod[];
  service: ServiceEndpoint[];
}

export interface AppPassword {
  name: string;
  createdAt: ISODateString;
  scopes?: string;
  createdByController?: string;
}

export interface CreatedAppPassword {
  name: string;
  password: string;
  createdAt: ISODateString;
  scopes?: string;
}

export interface InviteCodeUse {
  usedBy: Did;
  usedByHandle?: Handle;
  usedAt: ISODateString;
}

export interface InviteCodeInfo {
  code: InviteCodeBrand;
  available: number;
  disabled: boolean;
  forAccount: Did;
  createdBy: Did;
  createdAt: ISODateString;
  uses: InviteCodeUse[];
}

export interface CreateAccountParams {
  handle: string;
  email: string;
  password: string;
  inviteCode?: string;
  didType?: DidType;
  did?: string;
  signingKey?: string;
  verificationChannel?: VerificationChannel;
  discordUsername?: string;
  telegramUsername?: string;
  signalUsername?: string;
}

export interface CreateAccountResult {
  handle: Handle;
  did: Did;
  verificationRequired: boolean;
  verificationChannel: VerificationChannel;
}

export interface ConfirmSignupResult {
  accessJwt: AccessToken;
  refreshJwt: RefreshToken;
  handle: Handle;
  did: Did;
  email?: EmailAddress;
  emailConfirmed?: boolean;
  preferredChannel?: VerificationChannel;
  preferredChannelVerified?: boolean;
}


export interface ServerLinks {
  privacyPolicy?: string;
  termsOfService?: string;
}

export interface ServerContact {
  email?: string;
}

export interface ServerDescription {
  availableUserDomains: string[];
  inviteCodeRequired: boolean;
  did: string;
  contact?: ServerContact;
  links?: ServerLinks;
  version?: string;
  availableCommsChannels?: VerificationChannel[];
  selfHostedDidWebEnabled?: boolean;
  telegramBotUsername?: string;
  discordBotUsername?: string;
  discordAppId?: string;
}

export interface UpdateNotificationPrefsResponse {
  success: boolean;
  verificationRequired: string[];
}

export interface RepoInfo {
  did: Did;
  head: Cid;
  rev: string;
}

export interface ListReposResponse {
  repos: RepoInfo[];
  cursor?: string;
}

export interface NotificationPrefs {
  preferredChannel: VerificationChannel;
  email: EmailAddress;
  discordUsername: string | null;
  discordVerified: boolean;
  telegramUsername: string | null;
  telegramVerified: boolean;
  signalUsername: string | null;
  signalVerified: boolean;
}

export interface NotificationHistoryItem {
  createdAt: ISODateString;
  channel: VerificationChannel;
  notificationType: string;
  status: string;
  subject: string | null;
  body: string;
}

export interface NotificationHistoryResponse {
  notifications: NotificationHistoryItem[];
}

export interface ServerStats {
  userCount: number;
  repoCount: number;
  recordCount: number;
  blobStorageBytes: number;
}

export interface SignalStatus {
  linked: boolean;
}

export interface SignalLinkResult {
  qrBase64: string;
}

export interface ServerConfig {
  serverName: string;
  primaryColor: string | null;
  primaryColorDark: string | null;
  secondaryColor: string | null;
  secondaryColorDark: string | null;
  logoCid: Cid | null;
}

export interface BlobRef {
  $type: "blob";
  ref: { $link: Cid };
  mimeType: string;
  size: number;
}

export interface UploadBlobResponse {
  blob: BlobRef;
}

export interface SessionInfo {
  id: string;
  sessionType: SessionType;
  clientName: string | null;
  createdAt: ISODateString;
  expiresAt: ISODateString;
  isCurrent: boolean;
}

export interface ListSessionsResponse {
  sessions: SessionInfo[];
}


export interface AccountSearchResult {
  did: Did;
  handle: Handle;
  email?: EmailAddress;
  indexedAt: ISODateString;
  emailConfirmedAt?: ISODateString;
  deactivatedAt?: ISODateString;
}

export interface SearchAccountsResponse {
  cursor?: string;
  accounts: AccountSearchResult[];
}

export interface AdminInviteCodeUse {
  usedBy: Did;
  usedAt: ISODateString;
}

export interface AdminInviteCode {
  code: InviteCodeBrand;
  available: number;
  disabled: boolean;
  forAccount: Did;
  createdBy: Did;
  createdAt: ISODateString;
  uses: AdminInviteCodeUse[];
}

export interface GetInviteCodesResponse {
  cursor?: string;
  codes: AdminInviteCode[];
}

export interface AccountInfo {
  did: Did;
  handle: Handle;
  email?: EmailAddress;
  indexedAt: ISODateString;
  emailConfirmedAt?: ISODateString;
  invitesDisabled?: boolean;
  deactivatedAt?: ISODateString;
}

export interface RepoDescription {
  handle: Handle;
  did: Did;
  didDoc: DidDocument;
  collections: Nsid[];
  handleIsCorrect: boolean;
}

export interface RecordInfo {
  uri: AtUri;
  cid: Cid;
  value: unknown;
}

export interface ListRecordsResponse {
  records: RecordInfo[];
  cursor?: string;
}

export interface RecordResponse {
  uri: AtUri;
  cid: Cid;
  value: unknown;
}

export interface CreateRecordResponse {
  uri: AtUri;
  cid: Cid;
}

export interface TotpStatus {
  enabled: boolean;
  hasBackupCodes: boolean;
}

export interface TotpSecret {
  uri: string;
  qrBase64: string;
}

export interface EnableTotpResponse {
  success: boolean;
  backupCodes: string[];
}

export interface RegenerateBackupCodesResponse {
  backupCodes: string[];
}

export interface PasskeyInfo {
  id: string;
  credentialId: string;
  friendlyName: string | null;
  createdAt: ISODateString;
  lastUsed: ISODateString | null;
}

export interface ListPasskeysResponse {
  passkeys: PasskeyInfo[];
}

export interface StartPasskeyRegistrationResponse {
  options: PublicKeyCredentialCreationOptions;
}

export interface FinishPasskeyRegistrationResponse {
  id: string;
  credentialId: string;
}

export interface TrustedDevice {
  id: string;
  userAgent: string | null;
  friendlyName: string | null;
  trustedAt: ISODateString | null;
  trustedUntil: ISODateString | null;
  lastSeenAt: ISODateString;
}

export interface ListTrustedDevicesResponse {
  devices: TrustedDevice[];
}

export interface ReauthStatus {
  requiresReauth: boolean;
  lastReauthAt: ISODateString | null;
  availableMethods: ReauthMethod[];
}

export interface ReauthResponse {
  success: boolean;
  reauthAt: ISODateString;
}

export interface ReauthPasskeyStartResponse {
  options: PublicKeyCredentialRequestOptions;
}

export interface ReserveSigningKeyResponse {
  signingKey: PublicKeyMultibase;
}

export interface RecommendedDidCredentials {
  rotationKeys?: PublicKeyMultibase[];
  alsoKnownAs?: string[];
  verificationMethods?: { atproto?: PublicKeyMultibase };
  services?: { atproto_pds?: { type: string; endpoint: string } };
}

export interface PasskeyAccountCreateResponse {
  did: Did;
  handle: Handle;
  setupToken: string;
  setupExpiresAt: ISODateString;
}

export interface CompletePasskeySetupResponse {
  did: Did;
  handle: Handle;
  appPassword: string;
  appPasswordName: string;
}

export interface VerifyTokenResponse {
  success: boolean;
  did: Did;
  purpose: string;
  channel: VerificationChannel;
}

export interface EmailUpdateResponse {
  tokenRequired: boolean;
}

export interface LegacyLoginPreference {
  allowLegacyLogin: boolean;
  hasMfa: boolean;
}

export interface UpdateLegacyLoginResponse {
  allowLegacyLogin: boolean;
}

export interface UpdateLocaleResponse {
  preferredLocale: string;
}

export interface PasswordStatus {
  hasPassword: boolean;
}

export interface SuccessResponse {
  success: boolean;
}

export interface CheckEmailVerifiedResponse {
  verified: boolean;
}

export interface VerifyMigrationEmailResponse {
  success: boolean;
  did: Did;
}

export interface ResendMigrationVerificationResponse {
  sent: boolean;
}

export interface SsoLinkedAccount {
  id: string;
  provider: string;
  provider_name: string;
  provider_username: string;
  provider_email?: string;
  created_at: ISODateString;
  last_login_at?: ISODateString;
}

export interface DelegationController {
  did: Did;
  handle?: Handle;
  grantedScopes: ScopeSet;
  grantedAt: ISODateString;
  isActive: boolean;
  isLocal: boolean;
}

export interface DelegationControlledAccount {
  did: Did;
  handle?: Handle;
  grantedScopes: ScopeSet;
  grantedAt: ISODateString;
}

export interface DelegationScopePreset {
  name: string;
  scopes: ScopeSet;
  description: string;
}

export interface DelegationAuditEntry {
  id: string;
  action: string;
  actor_did: Did;
  target_did?: Did;
  details?: string;
  created_at: ISODateString;
}
