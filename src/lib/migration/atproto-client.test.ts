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
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://pds.example/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Aalice",
    );
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer access-token",
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

  it("shares one successful refresh between concurrent expired requests", async () => {
    let refreshCalls = 0;
    let expiredCalls = 0;
    let retryCalls = 0;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((input, init) => {
        const url = input.toString();
        const authorization = new Headers(init?.headers).get("Authorization");

        if (url.endsWith("com.atproto.server.refreshSession")) {
          refreshCalls += 1;
          return Promise.resolve(
            jsonResponse({
              did: "did:plc:alice",
              handle: "alice.test",
              accessJwt: "new-access",
              refreshJwt: "new-refresh",
            }),
          );
        }
        if (authorization === "Bearer old-access") {
          expiredCalls += 1;
          return Promise.resolve(
            jsonResponse(
              { error: "ExpiredToken", message: "token expired" },
              { status: 401 },
            ),
          );
        }

        retryCalls += 1;
        return Promise.resolve(
          jsonResponse({
            did: "did:plc:pds",
            availableUserDomains: [".test"],
            inviteCodeRequired: false,
          }),
        );
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtprotoClient("https://pds.example");
    client.setAccessToken("old-access");
    client.setRefreshToken("old-refresh");

    const [first, second] = await Promise.all([
      client.describeServer(),
      client.describeServer(),
    ]);

    expect(first.did).toBe("did:plc:pds");
    expect(second.did).toBe("did:plc:pds");
    expect({ refreshCalls, expiredCalls, retryCalls }).toEqual({
      refreshCalls: 1,
      expiredCalls: 2,
      retryCalls: 2,
    });
    expect(client.getAccessToken()).toBe("new-access");
    expect(client.getRefreshToken()).toBe("new-refresh");
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
    const retryHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(retryHeaders.get("Authorization")).toBe("DPoP access-token");
    expect(retryHeaders.get("DPoP")?.split(".")).toHaveLength(3);
  });

  it("uses an explicit refresh token without replacing it with the access token", async () => {
    const session = {
      did: "did:plc:alice",
      handle: "alice.example",
      accessJwt: "new-access",
      refreshJwt: "new-refresh",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(session));
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtprotoClient("https://pds.example");
    client.setAccessToken("old-access");

    await expect(client.refreshSession("explicit-refresh")).resolves.toEqual(
      session,
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer explicit-refresh");
  });

  it("returns the original error when token refresh fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "ExpiredToken", message: "access token expired" },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "InvalidToken" }, { status: 401 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtprotoClient("https://pds.example");
    client.setAccessToken("old-access");
    client.setRefreshToken("bad-refresh");

    const error = await client.describeServer().catch((caught) => caught);
    expect(error).toMatchObject({
      message: "access token expired",
      error: "ExpiredToken",
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves blob upload and download content types", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          blob: {
            $type: "blob",
            ref: { $link: "bafyblob" },
            mimeType: "image/png",
            size: 3,
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "image/png" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtprotoClient("https://pds.example");
    const bytes = new Uint8Array([1, 2, 3]);

    await client.uploadBlob(bytes, "image/png");
    await expect(
      client.getBlobWithContentType("did:plc:alice", "bafyblob"),
    ).resolves.toEqual({ data: bytes, contentType: "image/png" });
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Content-Type"),
    ).toBe("image/png");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(bytes);
  });

  it("keeps custom deactivated login fields on the raw XRPC path", async () => {
    const session = {
      did: "did:plc:alice",
      handle: "alice.example",
      accessJwt: "access",
      refreshJwt: "refresh",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(session));
    vi.stubGlobal("fetch", fetchMock);

    await new AtprotoClient("https://pds.example").loginDeactivated(
      "alice.example",
      "password",
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://pds.example/xrpc/com.atproto.server.createSession",
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      identifier: "alice.example",
      password: "password",
      allowDeactivated: true,
    });
  });

  it("preserves service authentication and errors for raw account creation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: "InvalidInviteCode", message: "invite rejected" },
          { status: 400 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const params = {
      handle: "alice.example",
      email: "alice@example.com",
      password: "password",
      inviteCode: "invite-code",
    };

    const error = await new AtprotoClient("https://pds.example")
      .createAccount(params, "service-token")
      .catch((caught: unknown) => caught);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer service-token",
    );
    expect(JSON.parse(init?.body as string)).toEqual(params);
    expect(error).toMatchObject({
      message: "invite rejected",
      error: "InvalidInviteCode",
      status: 400,
    });
  });

  it("preserves the passkey account payload on the shared raw path", async () => {
    const setup = {
      setupToken: "setup-token",
      did: "did:plc:alice",
      handle: "alice.example",
      setupExpiresAt: "2026-09-05T12:00:00Z",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(setup));
    vi.stubGlobal("fetch", fetchMock);
    const params = {
      handle: "alice.example",
      email: "alice@example.com",
      verificationChannel: "email" as const,
    };

    await expect(
      new AtprotoClient("https://pds.example").createPasskeyAccount(
        params,
        "service-token",
      ),
    ).resolves.toEqual(setup);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://pds.example/xrpc/_account.createPasskeyAccount");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer service-token",
    );
    expect(JSON.parse(init?.body as string)).toEqual(params);
  });
});

describe("identity resolution", () => {
  it("uses the public resolver for Bluesky handles", async () => {
    const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ did }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: did,
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
      did,
      pdsUrl: "https://alice.example",
    });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain(
      "public.api.bsky.app",
    );
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
    expect(fetchMock.mock.calls.map((call) => call[0].toString())).toEqual([
      "https://dns.google/resolve?name=_atproto.alice.example&type=TXT",
      "https://alice.example/.well-known/atproto-did",
      "https://alice.example/.well-known/did.json",
    ]);
  });

  it("uses a valid DNS handle record without requesting well-known", async () => {
    const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          Status: 0,
          TC: false,
          RD: true,
          RA: true,
          AD: true,
          CD: false,
          Question: [{ name: "_atproto.alice.example", type: 16 }],
          Answer: [
            {
              name: "_atproto.alice.example",
              type: 16,
              TTL: 60,
              data: `"did=${did}"`,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: did,
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

    await expect(resolvePdsUrl("alice.example")).resolves.toEqual({
      did,
      pdsUrl: "https://pds.example",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain("plc.directory");
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

  it.each([
    [
      "did:web:example.com%3A8443",
      "https://example.com:8443/.well-known/did.json",
    ],
    [
      "did:web:example.com:users:alice",
      "https://example.com/users/alice/did.json",
    ],
  ])("resolves standards-correct web DID URLs", async (did, expectedUrl) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: did }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveDidDocument(did)).resolves.toMatchObject({ id: did });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toBe(expectedUrl);
  });
});
