import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AtprotoClient,
  generateDPoPKeyPair,
  resolveDidDocument,
  resolvePdsUrl,
} from "./atproto-client.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AtprotoClient transport", () => {
  it("sends bearer authentication and parses binary responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "application/vnd.ipld.car" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtprotoClient("https://pds.example/");
    client.setAccessToken("access-token");

    await expect(client.getRepo("did:plc:alice")).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pds.example/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Aalice",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
        }),
      }),
    );
  });

  it("preserves XRPC error metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(
            { error: "InvalidRequest", message: "That did not work" },
            { status: 400 },
          ),
        ),
    );

    const error = await new AtprotoClient("https://pds.example")
      .describeServer()
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      message: "That did not work",
      error: "InvalidRequest",
      status: 400,
    });
  });

  it("refreshes one expired bearer token and retries the request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "ExpiredToken", message: "token expired" },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          did: "did:plc:alice",
          handle: "alice.test",
          accessJwt: "new-access",
          refreshJwt: "new-refresh",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          did: "did:plc:pds",
          availableUserDomains: [".test"],
          inviteCodeRequired: false,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtprotoClient("https://pds.example");
    client.setAccessToken("old-access");
    client.setRefreshToken("old-refresh");

    await expect(client.describeServer()).resolves.toMatchObject({
      did: "did:plc:pds",
    });
    expect(client.getAccessToken()).toBe("new-access");
    expect(client.getRefreshToken()).toBe("new-refresh");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries once with a DPoP nonce", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "use_dpop_nonce" },
          { status: 401, headers: { "DPoP-Nonce": "server-nonce" } },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          did: "did:plc:pds",
          availableUserDomains: [".test"],
          inviteCodeRequired: false,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtprotoClient("https://pds.example");
    client.setAccessToken("access-token");
    client.setDPoPKeyPair(await generateDPoPKeyPair());

    await client.describeServer();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(retryHeaders.Authorization).toBe("DPoP access-token");
    expect(retryHeaders.DPoP.split(".")).toHaveLength(3);
  });
});

describe("identity resolution", () => {
  it("uses the public resolver for Bluesky handles", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ did: "did:plc:alice" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "did:plc:alice",
          service: [
            {
              id: "#atproto_pds",
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://alice.example",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePdsUrl("@alice.bsky.social")).resolves.toEqual({
      did: "did:plc:alice",
      pdsUrl: "https://alice.example",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("public.api.bsky.app");
  });

  it("tries DNS before the well-known handle endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ Answer: [] }))
      .mockResolvedValueOnce(new Response("did:web:alice.example"))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "did:web:alice.example",
          service: [
            {
              id: "#atproto_pds",
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://pds.example",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePdsUrl("alice.example")).resolves.toMatchObject({
      did: "did:web:alice.example",
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://dns.google/resolve?name=_atproto.alice.example&type=TXT",
      "https://alice.example/.well-known/atproto-did",
      "https://alice.example/.well-known/did.json",
    ]);
  });

  it("rejects unsupported DID methods and documents without a PDS", async () => {
    await expect(resolveDidDocument("did:key:zExample")).rejects.toThrow(
      "Unsupported DID method",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ id: "did:plc:alice" })),
    );
    await expect(resolvePdsUrl("did:plc:alice")).rejects.toThrow(
      "No PDS service found",
    );
  });
});
