import { describe, expect, it, vi } from "vitest";
import { verifySigWithDidKey } from "@atcute/crypto";
import { createServiceJwt, generateKeypair } from "./crypto.ts";

function decodeJson(segment: string): Record<string, unknown> {
  const padded = segment
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    ),
  );
}

function decodeBase64Url(segment: string): Uint8Array<ArrayBuffer> {
  const padded = segment
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return new Uint8Array(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
}

describe("registration crypto", () => {
  it("generates storage-compatible raw secp256k1 key material", async () => {
    const keypair = await generateKeypair();

    expect(keypair.privateKey).toHaveLength(32);
    expect(keypair.publicKey).toHaveLength(33);
    expect(keypair.publicKeyMultibase).toMatch(/^z/);
    expect(keypair.publicKeyDidKey).toBe(
      `did:key:${keypair.publicKeyMultibase}`,
    );
  });

  it("creates a verifiable service JWT with the expected claims", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const keypair = await generateKeypair();
    const jwt = await createServiceJwt(
      keypair.privateKey,
      "did:web:alice.example",
      "did:web:pds.example",
      "com.atproto.server.createAccount",
    );
    const [header, payload, signature] = jwt.split(".");

    expect(decodeJson(header!)).toEqual({ alg: "ES256K", typ: "JWT" });
    expect(decodeJson(payload!)).toMatchObject({
      iss: "did:web:alice.example",
      sub: "did:web:alice.example",
      aud: "did:web:pds.example",
      iat: 1_800_000_000,
      exp: 1_800_000_180,
      lxm: "com.atproto.server.createAccount",
    });
    const signingInput = new TextEncoder().encode(`${header}.${payload}`);
    expect(
      await verifySigWithDidKey(
        keypair.publicKeyDidKey,
        decodeBase64Url(signature!),
        signingInput,
      ),
    ).toBe(true);
  });
});
