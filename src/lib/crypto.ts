import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { signJwt } from "./jwt.ts";

export interface Keypair {
  privateKey: Uint8Array;
  publicKeyMultibase: string;
}

export async function generateKeypair(): Promise<Keypair> {
  const keypair = await Secp256k1PrivateKeyExportable.createKeypair();
  const privateKey = await keypair.exportPrivateKey("raw");
  const publicKeyMultibase = await keypair.exportPublicKey("multikey");

  return {
    privateKey,
    publicKeyMultibase,
  };
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

  const keypair = await Secp256k1PrivateKeyExportable.importRaw(privateKey);
  return signJwt(keypair, header, payload);
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
