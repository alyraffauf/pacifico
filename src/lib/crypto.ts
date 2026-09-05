import * as secp from "@noble/secp256k1";
import { base58btc } from "multiformats/bases/base58";

const SECP256K1_MULTICODEC_PREFIX = new Uint8Array([0xe7, 0x01]);

export interface Keypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyMultibase: string;
  publicKeyDidKey: string;
}

export function generateKeypair(): Keypair {
  const privateKey = secp.utils.randomSecretKey();
  const publicKey = secp.getPublicKey(privateKey, true);

  const multicodecKey = new Uint8Array(
    SECP256K1_MULTICODEC_PREFIX.length + publicKey.length,
  );
  multicodecKey.set(SECP256K1_MULTICODEC_PREFIX, 0);
  multicodecKey.set(publicKey, SECP256K1_MULTICODEC_PREFIX.length);

  const publicKeyMultibase = base58btc.encode(multicodecKey);
  const publicKeyDidKey = `did:key:${publicKeyMultibase}`;

  return {
    privateKey,
    publicKey,
    publicKeyMultibase,
    publicKeyDidKey,
  };
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data;
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function createServiceJwt(
  privateKey: Uint8Array,
  issuerDid: string,
  audienceDid: string,
  lxm: string,
): Promise<string> {
  const header = {
    alg: "ES256K",
    typ: "JWT",
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuerDid,
    sub: issuerDid,
    aud: audienceDid,
    exp: now + 180,
    iat: now,
    lxm: lxm,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const message = `${headerEncoded}.${payloadEncoded}`;

  const msgBytes = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBytes);
  const msgHash = new Uint8Array(hashBuffer);
  const sigBytes = await secp.signAsync(msgHash, privateKey, {
    prehash: false,
  });
  const signatureEncoded = base64UrlEncode(sigBytes);

  return `${message}.${signatureEncoded}`;
}

export function generateDidDocument(
  did: string,
  publicKeyMultibase: string,
  handle: string,
  pdsEndpoint: string,
): object {
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      "https://w3id.org/security/suites/secp256k1-2019/v1",
    ],
    id: did,
    alsoKnownAs: [`at://${handle}`],
    verificationMethod: [
      {
        id: `${did}#atproto`,
        type: "Multikey",
        controller: did,
        publicKeyMultibase: publicKeyMultibase,
      },
    ],
    service: [
      {
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: pdsEndpoint,
      },
    ],
  };
}
