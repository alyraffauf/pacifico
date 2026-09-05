import type {
  AccountResult,
  ExternalDidWebState,
  RegistrationInfo,
  RegistrationMode,
  RegistrationStep,
  SessionState,
} from "./types.ts";

const STORAGE_KEY = "tranquil_registration_state";
const MAX_AGE_MS = 60 * 60 * 1000;

interface StoredRegistrationState {
  version: 1;
  startedAt: string;
  mode: RegistrationMode;
  step: RegistrationStep;
  pdsHostname: string;
  info: RegistrationInfo;
  externalDidWeb: StoredExternalDidWebState;
  account: StoredAccountResult | null;
  session: StoredSessionState | null;
}

interface StoredExternalDidWebState {
  keyMode: "reserved" | "byod";
  reservedSigningKey?: string;
  byodPrivateKeyBase64?: string;
  byodPublicKeyMultibase?: string;
  initialDidDocument?: string;
  updatedDidDocument?: string;
}

interface StoredAccountResult {
  did: string;
  handle: string;
  setupToken?: string;
  appPassword?: string;
  appPasswordName?: string;
}

interface StoredSessionState {
  accessJwt: string;
  refreshJwt: string;
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  return btoa(Array.from(arr, (byte) => String.fromCharCode(byte)).join(""));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function saveRegistrationState(
  mode: RegistrationMode,
  step: RegistrationStep,
  pdsHostname: string,
  info: RegistrationInfo,
  externalDidWeb: ExternalDidWebState,
  account: AccountResult | null,
  session: SessionState | null,
): void {
  const stored: StoredRegistrationState = {
    version: 1,
    startedAt: new Date().toISOString(),
    mode,
    step,
    pdsHostname,
    info: { ...info, password: undefined },
    externalDidWeb: {
      keyMode: externalDidWeb.keyMode,
      reservedSigningKey: externalDidWeb.reservedSigningKey,
      byodPrivateKeyBase64: externalDidWeb.byodPrivateKey
        ? uint8ArrayToBase64(externalDidWeb.byodPrivateKey)
        : undefined,
      byodPublicKeyMultibase: externalDidWeb.byodPublicKeyMultibase,
      initialDidDocument: externalDidWeb.initialDidDocument,
      updatedDidDocument: externalDidWeb.updatedDidDocument,
    },
    account: account
      ? {
        did: account.did,
        handle: account.handle,
        setupToken: account.setupToken,
        appPassword: account.appPassword,
        appPasswordName: account.appPasswordName,
      }
      : null,
    session: session
      ? {
        accessJwt: session.accessJwt,
        refreshJwt: session.refreshJwt,
      }
      : null,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch { /* localStorage unavailable */ }
}

export function loadRegistrationState(): {
  mode: RegistrationMode;
  step: RegistrationStep;
  pdsHostname: string;
  info: RegistrationInfo;
  externalDidWeb: ExternalDidWebState;
  account: AccountResult | null;
  session: SessionState | null;
} | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const state = JSON.parse(stored) as StoredRegistrationState;

    if (state.version !== 1) {
      clearRegistrationState();
      return null;
    }

    const startedAt = new Date(state.startedAt).getTime();
    if (Date.now() - startedAt > MAX_AGE_MS) {
      clearRegistrationState();
      return null;
    }

    return {
      mode: state.mode,
      step: state.step,
      pdsHostname: state.pdsHostname,
      info: state.info,
      externalDidWeb: {
        keyMode: state.externalDidWeb.keyMode,
        reservedSigningKey: state.externalDidWeb.reservedSigningKey,
        byodPrivateKey: state.externalDidWeb.byodPrivateKeyBase64
          ? base64ToUint8Array(state.externalDidWeb.byodPrivateKeyBase64)
          : undefined,
        byodPublicKeyMultibase: state.externalDidWeb.byodPublicKeyMultibase,
        initialDidDocument: state.externalDidWeb.initialDidDocument,
        updatedDidDocument: state.externalDidWeb.updatedDidDocument,
      },
      account: state.account
        ? {
          did: state.account.did as AccountResult["did"],
          handle: state.account.handle as AccountResult["handle"],
          setupToken: state.account.setupToken,
          appPassword: state.account.appPassword,
          appPasswordName: state.account.appPasswordName,
        }
        : null,
      session: state.session
        ? {
          accessJwt: state.session.accessJwt as SessionState["accessJwt"],
          refreshJwt: state.session.refreshJwt as SessionState["refreshJwt"],
        }
        : null,
    };
  } catch {
    clearRegistrationState();
    return null;
  }
}

export function clearRegistrationState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* localStorage unavailable */ }
}

export function hasPendingRegistration(): boolean {
  const state = loadRegistrationState();
  return state !== null && state.step !== "info" &&
    state.step !== "redirect-to-dashboard";
}

export function getRegistrationResumeInfo(): {
  mode: RegistrationMode;
  handle: string;
  step: RegistrationStep;
  did?: string;
} | null {
  const state = loadRegistrationState();
  if (
    !state || state.step === "info" || state.step === "redirect-to-dashboard"
  ) {
    return null;
  }

  return {
    mode: state.mode,
    handle: state.info.handle,
    step: state.step,
    did: state.account?.did,
  };
}
