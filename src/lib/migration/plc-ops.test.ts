import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { isSignedOperationValid, type Operation } from "@atcute/did-plc";
import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import {
  PlcOps,
  type PlcOperationData,
  type SignedPlcOperationData,
} from "./plc-ops.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function decodeJwtJson(segment: string): Record<string, unknown> {
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

describe("PlcOps", () => {
  it("signs, validates, and submits an operation to a custom directory", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signingKey = await Secp256k1PrivateKeyExportable.createKeypair();
    const didKey = await signingKey.exportPublicKey("did");

    await new PlcOps("https://plc.example/base/").signAndPublishNewOp(
      "did:plc:alice",
      signingKey,
      ["at://alice.example"],
      [didKey, didKey],
      "https://pds.example",
      didKey,
      "previous-cid",
    );

    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    expect(requestUrl.toString()).toBe("https://plc.example/did%3Aplc%3Aalice");
    expect(requestInit).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const operation = JSON.parse(
      requestInit?.body as string,
    ) as SignedPlcOperationData;
    expect(operation.rotationKeys).toEqual([didKey]);
    await expect(
      isSignedOperationValid([didKey], operation as Operation),
    ).resolves.toBe(didKey);
  });

  it("keeps Pacifico's five-key limit", async () => {
    const key = await Secp256k1PrivateKeyExportable.createKeypair();
    await expect(
      new PlcOps().signAndPublishNewOp(
        "did:plc:alice",
        key,
        [],
        Array.from({ length: 6 }, (_, index) => `did:key:z${index}`),
        "https://pds.example",
        "did:key:zVerification",
        "previous-cid",
      ),
    ).rejects.toThrow("Maximum 5 rotation keys allowed");
  });

  it("keeps the PLC service-token claims distinct from registration JWTs", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const key = await Secp256k1PrivateKeyExportable.createKeypair();

    const token = await new PlcOps().createServiceAuthToken(
      "did:plc:alice",
      "did:web:pds.example",
      key,
      "com.atproto.server.createAccount",
    );
    const [header, payload] = token.split(".");

    expect(decodeJwtJson(header!)).toEqual({ alg: "ES256K", typ: "JWT" });
    expect(decodeJwtJson(payload!)).toMatchObject({
      iss: "did:plc:alice",
      aud: "did:web:pds.example",
      iat: 1_800_000_000,
      exp: 1_800_000_060,
      lxm: "com.atproto.server.createAccount",
      jti: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(decodeJwtJson(payload!)).not.toHaveProperty("sub");
  });

  it("preserves directory error messages and status fallbacks", async () => {
    const operation: SignedPlcOperationData = {
      type: "plc_operation",
      prev: "previous-cid",
      alsoKnownAs: [],
      rotationKeys: ["did:key:zRotation"],
      verificationMethods: { atproto: "did:key:zVerification" },
      services: {},
      sig: "signature",
    };
    const jsonFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "operation rejected" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", jsonFetch);
    await expect(
      new PlcOps().pushPlcOperation("did:plc:alice", operation),
    ).rejects.toThrow("operation rejected");

    const textFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", textFetch);
    await expect(
      new PlcOps().pushPlcOperation("did:plc:alice", operation),
    ).rejects.toThrow("PLC directory returned HTTP 502");
  });

  it("accepts only signed operations for submission", async () => {
    expectTypeOf<
      Parameters<PlcOps["pushPlcOperation"]>[1]
    >().toEqualTypeOf<SignedPlcOperationData>();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const unsignedOperation: PlcOperationData = {
      type: "plc_operation",
      prev: "previous-cid",
      alsoKnownAs: [],
      rotationKeys: ["did:key:zRotation"],
      verificationMethods: { atproto: "did:key:zVerification" },
      services: {},
    };

    await expect(
      // @ts-expect-error PLC submission requires a signed operation.
      new PlcOps().pushPlcOperation("did:plc:alice", unsignedOperation),
    ).rejects.toThrow("A signed PLC operation is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
