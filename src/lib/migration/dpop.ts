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

export async function computeAccessTokenHash(
  accessToken: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(accessToken);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
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
