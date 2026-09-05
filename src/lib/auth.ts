import { api, ApiError, castSession, getSessionWithoutRefresh } from "./api.ts";
import type {
  CreateAccountParams,
  CreateAccountResult,
  Session,
} from "./types/api.ts";
import {
  type AccessToken,
  type Did,
  type Handle,
  type RefreshToken,
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsHandle,
  unsafeAsRefreshToken,
} from "./types/branded.ts";
import { err, isOk, ok, type Result } from "./types/result.ts";
import {
  checkForOAuthCallback,
  clearAllOAuthState,
  clearOAuthCallbackParams,
  handleOAuthCallback,
  refreshOAuthToken,
  startOAuthLogin,
} from "./oauth.ts";
import { setLocale, type SupportedLocale } from "./i18n.ts";

const STORAGE_KEY = "tranquil_pds_session";
const ACCOUNTS_KEY = "tranquil_pds_accounts";

export interface SavedAccount {
  readonly did: Did;
  readonly handle: Handle;
  readonly accessJwt: AccessToken;
  readonly refreshJwt: RefreshToken;
}

export type AuthError =
  | { readonly type: "network"; readonly message: string }
  | { readonly type: "unauthorized"; readonly message: string }
  | { readonly type: "validation"; readonly message: string }
  | { readonly type: "oauth"; readonly message: string }
  | { readonly type: "unknown"; readonly message: string };

function toAuthError(e: unknown): AuthError {
  if (e instanceof ApiError) {
    if (e.status === 401) {
      return { type: "unauthorized", message: e.message };
    }
    return { type: "validation", message: e.message };
  }
  if (e instanceof Error) {
    if (e.message.includes("network") || e.message.includes("fetch")) {
      return { type: "network", message: e.message };
    }
    return { type: "unknown", message: e.message };
  }
  return { type: "unknown", message: "An unknown error occurred" };
}

export type AuthState =
  | {
      readonly kind: "unauthenticated";
      readonly savedAccounts: readonly SavedAccount[];
    }
  | {
      readonly kind: "loading";
      readonly savedAccounts: readonly SavedAccount[];
      readonly previousSession: Session | null;
    }
  | {
      readonly kind: "authenticated";
      readonly session: Session;
      readonly savedAccounts: readonly SavedAccount[];
    }
  | {
      readonly kind: "error";
      readonly error: AuthError;
      readonly savedAccounts: readonly SavedAccount[];
    };

function createUnauthenticated(
  savedAccounts: readonly SavedAccount[],
): AuthState {
  return { kind: "unauthenticated", savedAccounts };
}

function createLoading(
  savedAccounts: readonly SavedAccount[],
  previousSession: Session | null = null,
): AuthState {
  return { kind: "loading", savedAccounts, previousSession };
}

function createAuthenticated(
  session: Session,
  savedAccounts: readonly SavedAccount[],
): AuthState {
  return { kind: "authenticated", session, savedAccounts };
}

function createError(
  error: AuthError,
  savedAccounts: readonly SavedAccount[],
): AuthState {
  return { kind: "error", error, savedAccounts };
}

const state: { current: AuthState } = {
  current: createLoading([]),
};
const listeners = new Set<() => void>();

function applyLocaleFromSession(sessionInfo: {
  preferredLocale?: string | null;
}): void {
  if (sessionInfo.preferredLocale) {
    setLocale(sessionInfo.preferredLocale as SupportedLocale);
  }
}

function sessionToSavedAccount(session: Session): SavedAccount {
  return {
    did: unsafeAsDid(session.did),
    handle: unsafeAsHandle(session.handle),
    accessJwt: unsafeAsAccessToken(session.accessJwt),
    refreshJwt: unsafeAsRefreshToken(session.refreshJwt),
  };
}

interface StoredSession {
  readonly did: string;
  readonly handle: string;
  readonly accessJwt: string;
  readonly refreshJwt: string;
  readonly email?: string;
  readonly emailConfirmed?: boolean;
  readonly preferredChannel?: string;
  readonly preferredChannelVerified?: boolean;
  readonly preferredLocale?: string | null;
}

function parseStoredSession(json: string): Result<StoredSession, Error> {
  try {
    const parsed = JSON.parse(json);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.did === "string" &&
      typeof parsed.handle === "string" &&
      typeof parsed.accessJwt === "string" &&
      typeof parsed.refreshJwt === "string"
    ) {
      return ok(parsed as StoredSession);
    }
    return err(new Error("Invalid session format"));
  } catch (e) {
    return err(e instanceof Error ? e : new Error("Failed to parse session"));
  }
}

function parseStoredAccounts(json: string): Result<SavedAccount[], Error> {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      return err(new Error("Invalid accounts format"));
    }
    const accounts: SavedAccount[] = parsed
      .filter(
        (
          a,
        ): a is {
          did: string;
          handle: string;
          accessJwt: string;
          refreshJwt: string;
        } =>
          typeof a === "object" &&
          a !== null &&
          typeof a.did === "string" &&
          typeof a.handle === "string" &&
          typeof a.accessJwt === "string" &&
          typeof a.refreshJwt === "string",
      )
      .map((a) => ({
        did: unsafeAsDid(a.did),
        handle: unsafeAsHandle(a.handle),
        accessJwt: unsafeAsAccessToken(a.accessJwt),
        refreshJwt: unsafeAsRefreshToken(a.refreshJwt),
      }));
    return ok(accounts);
  } catch (e) {
    return err(e instanceof Error ? e : new Error("Failed to parse accounts"));
  }
}

function loadSessionFromStorage(): StoredSession | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  const result = parseStoredSession(stored);
  return isOk(result) ? result.value : null;
}

function loadSavedAccountsFromStorage(): readonly SavedAccount[] {
  const stored = localStorage.getItem(ACCOUNTS_KEY);
  if (!stored) return [];
  const result = parseStoredAccounts(stored);
  return isOk(result) ? result.value : [];
}

function persistSession(session: Session | null): void {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function persistSavedAccounts(accounts: readonly SavedAccount[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function updateSavedAccounts(
  accounts: readonly SavedAccount[],
  session: Session,
): readonly SavedAccount[] {
  const newAccount = sessionToSavedAccount(session);
  const filtered = accounts.filter((a) => a.did !== newAccount.did);
  return [...filtered, newAccount];
}

function removeSavedAccountByDid(
  accounts: readonly SavedAccount[],
  did: Did,
): readonly SavedAccount[] {
  return accounts.filter((a) => a.did !== did);
}

function findSavedAccount(
  accounts: readonly SavedAccount[],
  did: Did,
): SavedAccount | undefined {
  return accounts.find((a) => a.did === did);
}

function getSavedAccounts(): readonly SavedAccount[] {
  return state.current.savedAccounts;
}

function setState(newState: AuthState): void {
  state.current = newState;
  listeners.forEach((listener) => listener());
}

function setAuthenticated(session: Session): void {
  const accounts = updateSavedAccounts(getSavedAccounts(), session);
  persistSession(session);
  persistSavedAccounts(accounts);
  setState(createAuthenticated(session, accounts));
}

function setUnauthenticated(): void {
  persistSession(null);
  setState(createUnauthenticated(getSavedAccounts()));
}

function setError(error: AuthError): void {
  setState(createError(error, getSavedAccounts()));
}

function setLoading(previousSession: Session | null = null): void {
  setState(createLoading(getSavedAccounts(), previousSession));
}

export function clearError(): void {
  if (state.current.kind === "error") {
    setState(createUnauthenticated(getSavedAccounts()));
  }
}

async function tryRefreshToken(): Promise<AccessToken | null> {
  if (state.current.kind !== "authenticated") return null;
  const currentSession = state.current.session;
  try {
    const tokens = await refreshOAuthToken(currentSession.refreshJwt);
    const sessionInfo = await getSessionWithoutRefresh(
      unsafeAsAccessToken(tokens.access_token),
    );
    const session: Session = {
      ...sessionInfo,
      accessJwt: unsafeAsAccessToken(tokens.access_token),
      refreshJwt: tokens.refresh_token
        ? unsafeAsRefreshToken(tokens.refresh_token)
        : currentSession.refreshJwt,
    };
    setAuthenticated(session);
    return session.accessJwt;
  } catch {
    return null;
  }
}

import { setTokenRefreshCallback } from "./api.ts";

export async function initAuth(): Promise<{ oauthLoginCompleted: boolean }> {
  setTokenRefreshCallback(tryRefreshToken);
  const savedAccounts = loadSavedAccountsFromStorage();
  setState(createLoading(savedAccounts));

  const oauthCallback = checkForOAuthCallback();
  if (oauthCallback) {
    clearOAuthCallbackParams();
    try {
      const tokens = await handleOAuthCallback(
        oauthCallback.code,
        oauthCallback.state,
      );
      const sessionInfo = await api.getSession(
        unsafeAsAccessToken(tokens.access_token),
      );
      const session: Session = {
        ...sessionInfo,
        accessJwt: unsafeAsAccessToken(tokens.access_token),
        refreshJwt: unsafeAsRefreshToken(tokens.refresh_token || ""),
      };
      setAuthenticated(session);
      applyLocaleFromSession(session);
      return { oauthLoginCompleted: true };
    } catch (e) {
      clearAllOAuthState();
      setError({
        type: "oauth",
        message: e instanceof Error ? e.message : "OAuth login failed",
      });
      return { oauthLoginCompleted: false };
    }
  }

  const stored = loadSessionFromStorage();
  if (stored) {
    try {
      const sessionInfo = await api.getSession(
        unsafeAsAccessToken(stored.accessJwt),
      );
      const session: Session = {
        ...sessionInfo,
        accessJwt: unsafeAsAccessToken(stored.accessJwt),
        refreshJwt: unsafeAsRefreshToken(stored.refreshJwt),
      };
      setAuthenticated(session);
      applyLocaleFromSession(session);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        try {
          const tokens = await refreshOAuthToken(stored.refreshJwt);
          const sessionInfo = await getSessionWithoutRefresh(
            unsafeAsAccessToken(tokens.access_token),
          );
          const session: Session = {
            ...sessionInfo,
            accessJwt: unsafeAsAccessToken(tokens.access_token),
            refreshJwt: tokens.refresh_token
              ? unsafeAsRefreshToken(tokens.refresh_token)
              : unsafeAsRefreshToken(stored.refreshJwt),
          };
          setAuthenticated(session);
          applyLocaleFromSession(session);
        } catch (refreshError) {
          console.error("Token refresh failed during init:", refreshError);
          setUnauthenticated();
        }
      } else {
        console.error("Non-401 error during getSession:", e);
        setUnauthenticated();
      }
    }
  } else {
    setState(createUnauthenticated(savedAccounts));
  }

  return { oauthLoginCompleted: false };
}

export async function login(
  identifier: string,
  password: string,
): Promise<Result<Session, AuthError>> {
  const currentState = state.current;
  const previousSession =
    currentState.kind === "authenticated" ? currentState.session : null;
  setLoading(previousSession);

  try {
    const session = await api.createSession(identifier, password);
    setAuthenticated(session);
    return ok(session);
  } catch (e) {
    const error = toAuthError(e);
    setError(error);
    return err(error);
  }
}

export async function loginWithOAuth(): Promise<Result<void, AuthError>> {
  clearAllOAuthState();
  setLoading();
  try {
    await startOAuthLogin();
    return ok(undefined);
  } catch (e) {
    const error = toAuthError(e);
    setError(error);
    return err(error);
  }
}

export async function register(
  params: CreateAccountParams,
): Promise<Result<CreateAccountResult, AuthError>> {
  try {
    const result = await api.createAccount(params);
    return ok(result);
  } catch (e) {
    return err(toAuthError(e));
  }
}

export async function confirmSignup(
  did: Did,
  verificationCode: string,
): Promise<Result<Session, AuthError>> {
  setLoading();
  try {
    const result = await api.confirmSignup(did, verificationCode);
    const session = castSession(result);
    setAuthenticated(session);
    return ok(session);
  } catch (e) {
    const error = toAuthError(e);
    setError(error);
    return err(error);
  }
}

export async function resendVerification(
  did: Did,
): Promise<Result<void, AuthError>> {
  try {
    await api.resendVerification(did);
    return ok(undefined);
  } catch (e) {
    return err(toAuthError(e));
  }
}

export function setSession(session: {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}): void {
  const newSession: Session = {
    did: unsafeAsDid(session.did),
    handle: unsafeAsHandle(session.handle),
    accessJwt: unsafeAsAccessToken(session.accessJwt),
    refreshJwt: unsafeAsRefreshToken(session.refreshJwt),
    contactKind: "none",
    accountKind: "active",
    isAdmin: false,
  };
  setAuthenticated(newSession);
}

export async function logout(): Promise<Result<void, AuthError>> {
  if (state.current.kind === "authenticated") {
    const { session } = state.current;
    const did = unsafeAsDid(session.did);
    try {
      await fetch("/oauth/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: session.refreshJwt }),
      });
    } catch {
      // Ignore revocation errors
    }
    const accounts = removeSavedAccountByDid(getSavedAccounts(), did);
    persistSavedAccounts(accounts);
    persistSession(null);
    setState(createUnauthenticated(accounts));
  } else {
    setUnauthenticated();
  }
  return ok(undefined);
}

export async function switchAccount(
  did: Did,
): Promise<Result<Session, AuthError>> {
  const account = findSavedAccount(getSavedAccounts(), did);
  if (!account) {
    return err({ type: "validation", message: "Account not found" });
  }

  setLoading();

  try {
    const sessionInfo = await api.getSession(account.accessJwt);
    const session: Session = {
      ...sessionInfo,
      accessJwt: account.accessJwt,
      refreshJwt: account.refreshJwt,
    };
    setAuthenticated(session);
    return ok(session);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      try {
        const tokens = await refreshOAuthToken(account.refreshJwt);
        const sessionInfo = await getSessionWithoutRefresh(
          unsafeAsAccessToken(tokens.access_token),
        );
        const session: Session = {
          ...sessionInfo,
          accessJwt: unsafeAsAccessToken(tokens.access_token),
          refreshJwt: tokens.refresh_token
            ? unsafeAsRefreshToken(tokens.refresh_token)
            : account.refreshJwt,
        };
        setAuthenticated(session);
        return ok(session);
      } catch {
        const accounts = removeSavedAccountByDid(getSavedAccounts(), did);
        persistSavedAccounts(accounts);
        const error: AuthError = {
          type: "unauthorized",
          message: "Session expired. Please log in again.",
        };
        setState(createError(error, accounts));
        return err(error);
      }
    }
    const error = toAuthError(e);
    setError(error);
    return err(error);
  }
}

export function forgetAccount(did: Did): void {
  const accounts = removeSavedAccountByDid(getSavedAccounts(), did);
  persistSavedAccounts(accounts);
  setState({
    ...state.current,
    savedAccounts: accounts,
  } as AuthState);
}

export function getAuthState(): AuthState {
  return state.current;
}

export function subscribeToAuthState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshSession(): Promise<Result<Session, AuthError>> {
  if (state.current.kind !== "authenticated") {
    return err({ type: "unauthorized", message: "Not authenticated" });
  }
  const currentSession = state.current.session;
  try {
    const sessionInfo = await api.getSession(currentSession.accessJwt);
    const session: Session = {
      ...sessionInfo,
      accessJwt: currentSession.accessJwt,
      refreshJwt: currentSession.refreshJwt,
    };
    setAuthenticated(session);
    return ok(session);
  } catch (e) {
    console.error("Failed to refresh session:", e);
    return err(toAuthError(e));
  }
}

export function getToken(): AccessToken | null {
  if (state.current.kind === "authenticated") {
    return state.current.session.accessJwt;
  }
  return null;
}

export async function getValidToken(): Promise<AccessToken | null> {
  if (state.current.kind !== "authenticated") return null;
  const currentSession = state.current.session;
  try {
    await api.getSession(currentSession.accessJwt);
    return currentSession.accessJwt;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      try {
        const tokens = await refreshOAuthToken(currentSession.refreshJwt);
        const sessionInfo = await getSessionWithoutRefresh(
          unsafeAsAccessToken(tokens.access_token),
        );
        const session: Session = {
          ...sessionInfo,
          accessJwt: unsafeAsAccessToken(tokens.access_token),
          refreshJwt: tokens.refresh_token
            ? unsafeAsRefreshToken(tokens.refresh_token)
            : currentSession.refreshJwt,
        };
        setAuthenticated(session);
        return session.accessJwt;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function isAuthenticated(): boolean {
  return state.current.kind === "authenticated";
}

export function isLoading(): boolean {
  return state.current.kind === "loading";
}

export function getError(): AuthError | null {
  return state.current.kind === "error" ? state.current.error : null;
}

export function getSession(): Session | null {
  return state.current.kind === "authenticated" ? state.current.session : null;
}

export function matchAuthState<T>(handlers: {
  unauthenticated: (accounts: readonly SavedAccount[]) => T;
  loading: (
    accounts: readonly SavedAccount[],
    previousSession: Session | null,
  ) => T;
  authenticated: (session: Session, accounts: readonly SavedAccount[]) => T;
  error: (error: AuthError, accounts: readonly SavedAccount[]) => T;
}): T {
  const current = state.current;
  switch (current.kind) {
    case "unauthenticated":
      return handlers.unauthenticated(current.savedAccounts);
    case "loading":
      return handlers.loading(current.savedAccounts, current.previousSession);
    case "authenticated":
      return handlers.authenticated(current.session, current.savedAccounts);
    case "error":
      return handlers.error(current.error, current.savedAccounts);
    default:
      throw new Error(
        `Unexpected auth state: ${(current as { kind: string }).kind}`,
      );
  }
}

export function setAuthStateForTest(newState: {
  session: Session | null;
  loading: boolean;
  error: string | null;
  savedAccounts?: SavedAccount[];
}): void {
  const accounts = newState.savedAccounts ?? [];
  if (newState.loading) {
    setState(createLoading(accounts, newState.session));
  } else if (newState.error) {
    setState(
      createError({ type: "unknown", message: newState.error }, accounts),
    );
  } else if (newState.session) {
    setState(createAuthenticated(newState.session, accounts));
  } else {
    setState(createUnauthenticated(accounts));
  }
}

export function resetAuthStateForTest(): void {
  setState(createLoading([]));
}

export function resetAuthForTest(): void {
  resetAuthStateForTest();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(ACCOUNTS_KEY);
}

export { type Session };
