declare const __brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type Did = Brand<string, "Did">;
export type DidPlc = Brand<Did, "DidPlc">;
export type DidWeb = Brand<Did, "DidWeb">;

export type Handle = Brand<string, "Handle">;
export type AccessToken = Brand<string, "AccessToken">;
export type RefreshToken = Brand<string, "RefreshToken">;
export type ServiceToken = Brand<string, "ServiceToken">;
export type SetupToken = Brand<string, "SetupToken">;

export type Cid = Brand<string, "Cid">;
export type Rkey = Brand<string, "Rkey">;
export type AtUri = Brand<string, "AtUri">;
export type Nsid = Brand<string, "Nsid">;

export type ISODateString = Brand<string, "ISODateString">;
export type EmailAddress = Brand<string, "EmailAddress">;
export type InviteCode = Brand<string, "InviteCode">;

export type PublicKeyMultibase = Brand<string, "PublicKeyMultibase">;
export type DidKeyString = Brand<string, "DidKeyString">;
export type ScopeSet = Brand<string, "ScopeSet">;

export function unsafeAsDid(s: string): Did {
  return s as Did;
}

export function unsafeAsHandle(s: string): Handle {
  return s as Handle;
}

export function unsafeAsAccessToken(s: string): AccessToken {
  return s as AccessToken;
}

export function unsafeAsRefreshToken(s: string): RefreshToken {
  return s as RefreshToken;
}

export function unsafeAsRkey(s: string): Rkey {
  return s as Rkey;
}

export function unsafeAsNsid(s: string): Nsid {
  return s as Nsid;
}

export function unsafeAsISODate(s: string): ISODateString {
  return s as ISODateString;
}

export const unsafeAsISODateString = unsafeAsISODate;

export function unsafeAsEmail(s: string): EmailAddress {
  return s as EmailAddress;
}

export function unsafeAsInviteCode(s: string): InviteCode {
  return s as InviteCode;
}

export function unsafeAsScopeSet(s: string): ScopeSet {
  return s as ScopeSet;
}

