import { afterEach, describe, expect, it, vi } from "vitest";
import { isSignedOperationValid, type Operation } from "@atcute/did-plc";
import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { PlcOps, type PlcOperationData } from "./plc-ops.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    ) as PlcOperationData & { sig: string };
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

  it("preserves directory error messages and status fallbacks", async () => {
    const operation: PlcOperationData = {
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
});
