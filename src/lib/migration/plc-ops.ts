import {
  defs,
  type IndexedEntry,
  normalizeOp,
  type Operation,
} from "@atcute/did-plc";
import {
  P256PrivateKey,
  parsePrivateMultikey,
  parsePublicMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import * as CBOR from "@atcute/cbor";
import {
  fromBase16,
  fromBase58Btc,
  fromBase64Url,
  toBase64Url,
} from "@atcute/multibase";

export type PrivateKey = P256PrivateKey | Secp256k1PrivateKey;

export interface KeypairInfo {
  type: "private_key";
  didPublicKey: `did:key:${string}`;
  keypair: PrivateKey;
}

export interface PlcService {
  type: string;
  endpoint: string;
}

export interface PlcOperationData {
  type: "plc_operation";
  prev: string | null;
  alsoKnownAs: string[];
  rotationKeys: string[];
  services: Record<string, PlcService>;
  verificationMethods: Record<string, string>;
  sig?: string;
}

type KeyCurve = "secp256k1" | "p256";

const HEX_PRIVATE_KEY_REGEX = /^[0-9a-f]{64}$/i;
const BASE58BTC_CHARSET_REGEX = /^[a-km-zA-HJ-NP-Z1-9]+$/;

const importRawBytes = (
  bytes: Uint8Array,
  curve: KeyCurve,
): Promise<PrivateKey> =>
  curve === "p256"
    ? P256PrivateKey.importRaw(bytes)
    : Secp256k1PrivateKey.importRaw(bytes);

const importFromMultikeyMatch = (
  match: ReturnType<typeof parsePrivateMultikey>,
): Promise<PrivateKey> =>
  match.type === "p256"
    ? P256PrivateKey.importRaw(match.privateKeyBytes)
    : Secp256k1PrivateKey.importRaw(match.privateKeyBytes);

const importJwk = async (
  json: string,
  _curve: KeyCurve,
): Promise<PrivateKey> => {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid JWK: expected a JSON object");
  }
  const jwk = parsed as Record<string, unknown>;

  if (jwk.kty !== "EC") {
    throw new Error(
      `Unsupported JWK key type: ${
        String(jwk.kty)
      }. Only EC keys are supported`,
    );
  }

  if (typeof jwk.d !== "string") {
    throw new Error(
      "This JWK is a public key (missing 'd' parameter). The private key JWK is required",
    );
  }

  const detectedCurve: KeyCurve = (() => {
    switch (jwk.crv) {
      case "secp256k1":
        return "secp256k1";
      case "P-256":
        return "p256";
      default:
        throw new Error(
          `Unsupported JWK curve: ${
            String(jwk.crv)
          }. Expected secp256k1 or P-256`,
        );
    }
  })();

  const privateKeyBytes = fromBase64Url(jwk.d);
  return importRawBytes(privateKeyBytes, detectedCurve);
};

const importMultikeyOrBase58 = (
  input: string,
  curve: KeyCurve,
): Promise<PrivateKey> => {
  try {
    const match = parsePrivateMultikey(input);
    return importFromMultikeyMatch(match);
  } catch {
    try {
      parsePublicMultikey(input);
      throw new Error(
        "This is a public multikey. The private key multikey is required",
      );
    } catch (publicErr) {
      if (
        publicErr instanceof Error &&
        publicErr.message.includes("public multikey")
      ) {
        throw publicErr;
      }
    }

    try {
      return importBase58Raw(input, curve);
    } catch {
      return importBase58Raw(input.slice(1), curve);
    }
  }
};

const importBase58Raw = (
  input: string,
  curve: KeyCurve,
): Promise<PrivateKey> => {
  const bytes = fromBase58Btc(input);
  if (bytes.length !== 32) {
    throw new Error(
      `Invalid base58 key: decoded to ${bytes.length} bytes, expected 32`,
    );
  }
  return importRawBytes(bytes, curve);
};

const detectAndImportPrivateKey = (
  input: string,
  curve: KeyCurve,
): Promise<PrivateKey> => {
  if (input.startsWith("{")) {
    return importJwk(input, curve);
  }

  if (HEX_PRIVATE_KEY_REGEX.test(input)) {
    return importRawBytes(fromBase16(input.toLowerCase()), curve);
  }

  if (input.startsWith("z")) {
    return importMultikeyOrBase58(input, curve);
  }

  if (BASE58BTC_CHARSET_REGEX.test(input)) {
    return importBase58Raw(input, curve);
  }

  throw new Error(
    "Unrecognized key format. Expected hex, base58, multikey, or JWK",
  );
};

const jsonToB64Url = (obj: unknown): string => {
  const enc = new TextEncoder();
  const json = JSON.stringify(obj);
  return toBase64Url(enc.encode(json));
};

export class PlcOps {
  private plcDirectoryUrl: string;

  constructor(plcDirectoryUrl = "https://plc.directory") {
    this.plcDirectoryUrl = plcDirectoryUrl;
  }

  async getPlcAuditLogs(did: string): Promise<IndexedEntry[]> {
    const response = await fetch(`${this.plcDirectoryUrl}/${did}/log/audit`);
    if (!response.ok) {
      throw new Error(`Failed to fetch PLC audit logs: ${response.status}`);
    }
    const json = await response.json();
    return defs.indexedEntryLog.parse(json);
  }

  async getLastPlcOpFromPlc(
    did: string,
  ): Promise<{ lastOperation: Operation; base: IndexedEntry }> {
    const logs = await this.getPlcAuditLogs(did);
    const lastOp = logs.at(-1);
    if (!lastOp) {
      throw new Error("No PLC operations found for this DID");
    }
    if (lastOp.operation.type === "plc_tombstone") {
      throw new Error("DID has been tombstoned");
    }
    return { lastOperation: normalizeOp(lastOp.operation), base: lastOp };
  }

  async getCurrentRotationKeysForUser(did: string): Promise<string[]> {
    const { lastOperation } = await this.getLastPlcOpFromPlc(did);
    return lastOperation.rotationKeys || [];
  }

  async createNewSecp256k1Keypair(): Promise<
    { privateKey: string; publicKey: `did:key:${string}` }
  > {
    const keypair = await Secp256k1PrivateKeyExportable.createKeypair();
    const publicKey = await keypair.exportPublicKey("did");
    const privateKey = await keypair.exportPrivateKey("multikey");
    return { privateKey, publicKey };
  }

  async getKeyPair(
    privateKeyString: string,
    type: KeyCurve = "secp256k1",
  ): Promise<KeypairInfo> {
    const trimmed = privateKeyString.trim();

    if (trimmed.length === 0) {
      throw new Error("Private key is required");
    }

    if (trimmed.startsWith("did:key:")) {
      throw new Error(
        "This is a did:key public key identifier. The private key is required",
      );
    }

    const keypair = await detectAndImportPrivateKey(trimmed, type);

    return {
      type: "private_key",
      didPublicKey: await keypair.exportPublicKey("did"),
      keypair,
    };
  }

  async getMatchingKeyPair(
    privateKeyString: string,
    acceptableDidKeys: readonly string[],
  ): Promise<KeypairInfo | null> {
    const curves: readonly KeyCurve[] = ["secp256k1", "p256"];
    const results = await Promise.allSettled(
      curves.map((curve) => this.getKeyPair(privateKeyString, curve)),
    );
    const candidates = results
      .filter(
        (r): r is PromiseFulfilledResult<KeypairInfo> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);
    if (candidates.length === 0) {
      const rejection = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      throw rejection?.reason ?? new Error("Unrecognized key format");
    }
    return (
      candidates.find((info) =>
        acceptableDidKeys.includes(info.didPublicKey)
      ) ?? null
    );
  }

  async signAndPublishNewOp(
    did: string,
    signingRotationKey: PrivateKey,
    alsoKnownAs: string[],
    rotationKeys: string[],
    pds: string,
    verificationKey: string,
    prev: string,
  ): Promise<void> {
    const rotationKeysToUse = [...new Set(rotationKeys)];
    if (rotationKeysToUse.length === 0) {
      throw new Error("No rotation keys provided");
    }
    if (rotationKeysToUse.length > 5) {
      throw new Error("Maximum 5 rotation keys allowed");
    }

    const operation: PlcOperationData = {
      type: "plc_operation",
      prev,
      alsoKnownAs,
      rotationKeys: rotationKeysToUse,
      services: {
        atproto_pds: {
          type: "AtprotoPersonalDataServer",
          endpoint: pds,
        },
      },
      verificationMethods: {
        atproto: verificationKey,
      },
    };

    const opBytes = CBOR.encode(operation);
    const sigBytes = await signingRotationKey.sign(opBytes);
    const signature = toBase64Url(sigBytes);

    const signedOperation = {
      ...operation,
      sig: signature,
    };

    await this.pushPlcOperation(did, signedOperation);
  }

  async pushPlcOperation(
    did: string,
    operation: PlcOperationData,
  ): Promise<void> {
    const response = await fetch(`${this.plcDirectoryUrl}/${did}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(operation),
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const json = await response.json();
        if (
          typeof json === "object" && json !== null &&
          typeof json.message === "string"
        ) {
          throw new Error(json.message);
        }
      }
      throw new Error(`PLC directory returned HTTP ${response.status}`);
    }
  }

  async createServiceAuthToken(
    iss: string,
    aud: string,
    keypair: PrivateKey,
    lxm: string,
  ): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 60;

    const jti = (() => {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    })();

    const header = { typ: "JWT", alg: "ES256K" };
    const payload = { iat, iss, aud, exp, lxm, jti };

    const headerB64 = jsonToB64Url(header);
    const payloadB64 = jsonToB64Url(payload);
    const toSignStr = `${headerB64}.${payloadB64}`;

    const toSignBytes = new TextEncoder().encode(toSignStr);
    const sigBytes = await keypair.sign(toSignBytes);
    const sigB64 = toBase64Url(sigBytes);

    return `${toSignStr}.${sigB64}`;
  }

  async signPlcOperationWithCredentials(
    did: string,
    signingKey: PrivateKey,
    credentials: {
      rotationKeys?: string[];
      alsoKnownAs?: string[];
      verificationMethods?: Record<string, string>;
      services?: Record<string, PlcService>;
    },
    additionalRotationKeys: string[],
    prevCid: string,
  ): Promise<void> {
    const rotationKeys = [
      ...new Set([
        ...(additionalRotationKeys || []),
        ...(credentials.rotationKeys || []),
      ]),
    ];

    if (rotationKeys.length === 0) {
      throw new Error("No rotation keys provided");
    }
    if (rotationKeys.length > 5) {
      throw new Error("Maximum 5 rotation keys allowed");
    }

    const operation: PlcOperationData = {
      type: "plc_operation",
      prev: prevCid,
      alsoKnownAs: credentials.alsoKnownAs || [],
      rotationKeys,
      services: credentials.services || {},
      verificationMethods: credentials.verificationMethods || {},
    };

    const opBytes = CBOR.encode(operation);
    const sigBytes = await signingKey.sign(opBytes);
    const signature = toBase64Url(sigBytes);

    const signedOperation = {
      ...operation,
      sig: signature,
    };

    await this.pushPlcOperation(did, signedOperation);
  }
}

export const plcOps = new PlcOps();
