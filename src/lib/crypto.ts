import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";

export interface Keypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyMultibase: string;
  publicKeyDidKey: string;
}

export async function generateKeypair(): Promise<Keypair> {
  const keypair = await Secp256k1PrivateKeyExportable.createKeypair();
  const privateKey = await keypair.exportPrivateKey("raw");
  const publicKey = await keypair.exportPublicKey("raw");
  const publicKeyMultibase = await keypair.exportPublicKey("multikey");
  const publicKeyDidKey = await keypair.exportPublicKey("did");

  return {
    privateKey,
    publicKey,
    publicKeyMultibase,
    publicKeyDidKey,
  };
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
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

  const keypair = await Secp256k1PrivateKeyExportable.importRaw(privateKey);
  const sigBytes = await keypair.sign(new TextEncoder().encode(message));
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
