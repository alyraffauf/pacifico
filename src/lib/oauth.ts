const OAUTH_STATE_KEY = "tranquil_pds_oauth_state";
const OAUTH_VERIFIER_KEY = "tranquil_pds_oauth_verifier";
const DPOP_KEY_STORE = "tranquil_pds_dpop_keys";
const DPOP_NONCE_KEY = "tranquil_pds_dpop_nonce";

export const SCOPES = [
  "atproto",
  "repo:*?action=create",
  "repo:*?action=update",
  "repo:*?action=delete",
  "blob:*/*",
  "identity:*",
  "account:*?action=manage",
].join(" ");

const CLIENT_ID =
  !(import.meta.env.DEV) || globalThis.location?.hostname !== 'localhost'
    ? `${globalThis.location.origin}/oauth-client-metadata.json`
    : `http://localhost/?scope=${encodeURIComponent(SCOPES)}`;

const REDIRECT_URI = `${globalThis.location.origin}/app/`;

interface OAuthState {
  state: string;
  codeVerifier: string;
  returnTo?: string;
}

interface DPoPKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  jwk: JsonWebKey;
}

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await sha256(verifier);
  return base64UrlEncode(hash);
}

export function generateState(): string {
  return generateRandomString(32);
}

export function generateCodeVerifier(): string {
  return generateRandomString(32);
}

export function saveOAuthState(state: OAuthState): void {
  sessionStorage.setItem(OAUTH_STATE_KEY, state.state);
  sessionStorage.setItem(OAUTH_VERIFIER_KEY, state.codeVerifier);
}

function getOAuthState(): OAuthState | null {
  const state = sessionStorage.getItem(OAUTH_STATE_KEY);
  const codeVerifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY);
  if (!state || !codeVerifier) return null;
  return { state, codeVerifier };
}

function clearOAuthState(): void {
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_VERIFIER_KEY);
}

function clearDPoPNonce(): void {
  sessionStorage.removeItem(DPOP_NONCE_KEY);
}

export function clearAllOAuthState(): void {
  clearOAuthState();
  clearDPoPNonce();
}

async function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DPOP_KEY_STORE, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("keys")) {
        db.createObjectStore("keys");
      }
    };
  });
}

async function storeDPoPKeyPair(keyPair: DPoPKeyPair): Promise<void> {
  const db = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    const store = tx.objectStore("keys");
    store.put(keyPair.publicKey, "publicKey");
    store.put(keyPair.privateKey, "privateKey");
    store.put(keyPair.jwk, "jwk");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function loadDPoPKeyPair(): Promise<DPoPKeyPair | null> {
  try {
    const db = await openKeyStore();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("keys", "readonly");
      const store = tx.objectStore("keys");
      const publicKeyReq = store.get("publicKey");
      const privateKeyReq = store.get("privateKey");
      const jwkReq = store.get("jwk");
      tx.oncomplete = () => {
        db.close();
        if (publicKeyReq.result && privateKeyReq.result && jwkReq.result) {
          resolve({
            publicKey: publicKeyReq.result,
            privateKey: privateKeyReq.result,
            jwk: jwkReq.result,
          });
        } else {
          resolve(null);
        }
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    return null;
  }
}

async function generateDPoPKeyPair(): Promise<DPoPKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    jwk,
  };
}

async function getOrCreateDPoPKeyPair(): Promise<DPoPKeyPair> {
  const existing = await loadDPoPKeyPair();
  if (existing) return existing;

  const keyPair = await generateDPoPKeyPair();
  await storeDPoPKeyPair(keyPair);
  return keyPair;
}

async function createDPoPProof(
  keyPair: DPoPKeyPair,
  method: string,
  url: string,
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
    jti: generateRandomString(16),
    htm: method.toUpperCase(),
    htu: url.split("?")[0],
    iat: Math.floor(Date.now() / 1000),
  };

  if (nonce) {
    payload.nonce = nonce;
  }

  if (accessTokenHash) {
    payload.ath = accessTokenHash;
  }

  const headerB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(header)).buffer as ArrayBuffer,
  );
  const payloadB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer,
  );
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );

  const sigBytes = new Uint8Array(signature);
  const signatureB64 = base64UrlEncode(sigBytes.buffer);

  return `${signingInput}.${signatureB64}`;
}

async function computeJwkThumbprint(jwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  const hash = await sha256(canonical);
  return base64UrlEncode(hash);
}

export function getDPoPNonce(): string | null {
  return sessionStorage.getItem(DPOP_NONCE_KEY);
}

export function setDPoPNonce(nonce: string): void {
  sessionStorage.setItem(DPOP_NONCE_KEY, nonce);
}

export function extractDPoPNonceFromResponse(response: Response): void {
  const nonce = response.headers.get("DPoP-Nonce");
  if (nonce) {
    setDPoPNonce(nonce);
  }
}

async function startOAuthFlow(options?: {
  loginHint?: string;
  prompt?: string;
}): Promise<void> {
  clearAllOAuthState();

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const keyPair = await getOrCreateDPoPKeyPair();
  const dpopJkt = await computeJwkThumbprint(keyPair.jwk);

  saveOAuthState({ state, codeVerifier });

  const parParams: Record<string, string> = {
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    dpop_jkt: dpopJkt,
  };
  if (options?.loginHint) {
    parParams.login_hint = options.loginHint;
  }
  if (options?.prompt) {
    parParams.prompt = options.prompt;
  }

  const parResponse = await fetch("/oauth/par", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parParams),
  });

  if (!parResponse.ok) {
    const error = await parResponse.json().catch(() => ({
      error: "Unknown error",
    }));
    throw new Error(
      error.error_description || error.error || "Failed to start OAuth flow",
    );
  }

  const { request_uri } = await parResponse.json();

  const authorizeUrl = new URL("/oauth/authorize", globalThis.location.origin);
  authorizeUrl.searchParams.set("client_id", CLIENT_ID);
  authorizeUrl.searchParams.set("request_uri", request_uri);

  globalThis.location.href = authorizeUrl.toString();
}

export async function startOAuthLogin(loginHint?: string): Promise<void> {
  return startOAuthFlow({ loginHint });
}

export async function startOAuthRegister(): Promise<void> {
  return startOAuthFlow({ prompt: "create" });
}

export async function getOAuthRequestUri(prompt?: string): Promise<string> {
  clearAllOAuthState();

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const keyPair = await getOrCreateDPoPKeyPair();
  const dpopJkt = await computeJwkThumbprint(keyPair.jwk);

  saveOAuthState({ state, codeVerifier });

  const parParams: Record<string, string> = {
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    dpop_jkt: dpopJkt,
  };
  if (prompt) {
    parParams.prompt = prompt;
  }

  const parResponse = await fetch("/oauth/par", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parParams),
  });

  if (!parResponse.ok) {
    const error = await parResponse.json().catch(() => ({
      error: "Unknown error",
    }));
    throw new Error(
      error.error_description || error.error || "Failed to get request URI",
    );
  }

  const { request_uri } = await parResponse.json();
  return request_uri;
}

export function getRequestUriFromUrl(): string | null {
  const params = new URLSearchParams(globalThis.location.search);
  return params.get("request_uri");
}

export async function ensureRequestUri(
  prompt = "create",
): Promise<string | null> {
  const existing = getRequestUriFromUrl();
  if (existing) return existing;

  const newRequestUri = await getOAuthRequestUri(prompt);
  const url = new URL(globalThis.location.href);
  url.searchParams.set("request_uri", newRequestUri);
  globalThis.location.href = url.toString();
  return null;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  sub: string;
}

async function tokenRequest(
  params: URLSearchParams,
  retryWithNonce = true,
): Promise<OAuthTokens> {
  const keyPair = await getOrCreateDPoPKeyPair();
  const tokenEndpoint = `${globalThis.location.origin}/oauth/token`;

  const dpopProof = await createDPoPProof(
    keyPair,
    "POST",
    tokenEndpoint,
    getDPoPNonce() ?? undefined,
  );

  const response = await fetch("/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "DPoP": dpopProof,
    },
    body: params,
  });

  extractDPoPNonceFromResponse(response);

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Unknown error",
    }));

    if (retryWithNonce && error.error === "use_dpop_nonce" && getDPoPNonce()) {
      return tokenRequest(params, false);
    }

    throw new Error(
      error.error_description || error.error || "Token request failed",
    );
  }

  return response.json();
}

export async function handleOAuthCallback(
  code: string,
  state: string,
): Promise<OAuthTokens> {
  const savedState = getOAuthState();
  if (!savedState) {
    throw new Error("No OAuth state found. Please try logging in again.");
  }

  if (savedState.state !== state) {
    clearOAuthState();
    throw new Error("OAuth state mismatch. Please try logging in again.");
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: code,
    redirect_uri: REDIRECT_URI,
    code_verifier: savedState.codeVerifier,
  });

  clearOAuthState();

  return tokenRequest(params);
}

export async function refreshOAuthToken(
  refreshToken: string,
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  return tokenRequest(params);
}

export function checkForOAuthCallback():
  | { code: string; state: string }
  | null {
  if (globalThis.location.pathname === "/app/migrate") {
    return null;
  }

  const params = new URLSearchParams(globalThis.location.search);
  const code = params.get("code");
  const state = params.get("state");

  if (code && state) {
    return { code, state };
  }

  return null;
}

export function clearOAuthCallbackParams(): void {
  const url = new URL(globalThis.location.href);
  url.search = "";
  globalThis.history.replaceState({}, "", url.toString());
}

export async function createDPoPProofForRequest(
  method: string,
  url: string,
  accessToken: string,
): Promise<string> {
  const keyPair = await getOrCreateDPoPKeyPair();
  const tokenHash = await sha256(accessToken);
  const ath = base64UrlEncode(tokenHash);
  return createDPoPProof(
    keyPair,
    method,
    url,
    getDPoPNonce() ?? undefined,
    ath,
  );
}
