import { beforeEach, describe, expect, it, vi } from "vitest";
import { unsafeAsAccessToken } from "./types/branded.ts";

type FetchCall = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type RefreshCall = () => Promise<ReturnType<typeof unsafeAsAccessToken>>;

const oauthMocks = vi.hoisted(() => ({
  createDPoPProofForRequest: vi.fn<
    (method: string, url: string, token: string) => Promise<string>
  >(
    async (method: string, url: string, token: string) =>
      `proof:${method}:${url}:${token}`,
  ),
  setDPoPNonce: vi.fn<(nonce: string) => void>(),
}));

vi.mock("./oauth.ts", () => ({
  createDPoPProofForRequest: oauthMocks.createDPoPProofForRequest,
  setDPoPNonce: oauthMocks.setDPoPNonce,
}));

import { ApiError, MainApiTransport } from "./api-transport.ts";

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("MainApiTransport", () => {
  beforeEach(() => {
    oauthMocks.createDPoPProofForRequest.mockClear();
    oauthMocks.setDPoPNonce.mockClear();
  });

  it("fetches relative URLs and signs an absolute URL without its query", async () => {
    const fetchMock = vi.fn<FetchCall>(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new MainApiTransport();

    await transport.request("/xrpc/example.test", {
      params: { value: "a b" },
      authentication: {
        type: "refreshable-dpop",
        token: unsafeAsAccessToken("access-token"),
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/xrpc/example.test?value=a+b",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(oauthMocks.createDPoPProofForRequest).toHaveBeenCalledWith(
      "GET",
      `${location.origin}/xrpc/example.test`,
      "access-token",
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("DPoP access-token");
    expect(headers.get("dpop")).toContain("proof:GET:");
  });

  it.each([
    ["none", { type: "none" } as const, null, false],
    [
      "bearer",
      { type: "bearer", token: "service-token" } as const,
      "Bearer service-token",
      false,
    ],
    [
      "non-refreshable DPoP",
      {
        type: "dpop",
        token: unsafeAsAccessToken("session-token"),
      } as const,
      "DPoP session-token",
      true,
    ],
    [
      "refreshable DPoP",
      {
        type: "refreshable-dpop",
        token: unsafeAsAccessToken("access-token"),
      } as const,
      "DPoP access-token",
      true,
    ],
  ])(
    "applies %s authentication",
    async (_name, authentication, expected, dpop) => {
      const fetchMock = vi.fn<FetchCall>(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          json({ ok: true }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await new MainApiTransport().request("/test", { authentication });

      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(headers.get("authorization")).toBe(expected);
      expect(headers.has("dpop")).toBe(dpop);
    },
  );

  it("captures a nonce and retries use_dpop_nonce once", async () => {
    const fetchMock = vi
      .fn<FetchCall>()
      .mockResolvedValueOnce(
        json({ error: "use_dpop_nonce" }, 401, { "DPoP-Nonce": "first" }),
      )
      .mockResolvedValueOnce(
        json({ error: "use_dpop_nonce" }, 401, { "DPoP-Nonce": "second" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await new MainApiTransport().request("/test", {
      authentication: {
        type: "dpop",
        token: unsafeAsAccessToken("token"),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(oauthMocks.setDPoPNonce.mock.calls).toEqual([["first"], ["second"]]);
  });

  it("retries an expired request once with a fresh token", async () => {
    const fetchMock = vi
      .fn<FetchCall>()
      .mockResolvedValueOnce(json({ error: "ExpiredToken" }, 401))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = new MainApiTransport();
    const refresh = vi.fn<RefreshCall>(async () =>
      unsafeAsAccessToken("fresh-token"),
    );
    transport.setTokenRefreshCallback(refresh);

    const response = await transport.request("/test", {
      authentication: {
        type: "refreshable-dpop",
        token: unsafeAsAccessToken("expired-token"),
      },
    });

    expect(response.ok).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    const retryHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(retryHeaders.get("authorization")).toBe("DPoP fresh-token");
  });

  it("does not refresh non-refreshable DPoP requests", async () => {
    const fetchMock = vi.fn<FetchCall>(async () =>
      json({ error: "ExpiredToken" }, 401),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new MainApiTransport();
    const refresh = vi.fn<RefreshCall>(async () =>
      unsafeAsAccessToken("fresh-token"),
    );
    transport.setTokenRefreshCallback(refresh);

    const response = await transport.request("/test", {
      authentication: {
        type: "dpop",
        token: unsafeAsAccessToken("expired-token"),
      },
    });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns the original failure when refresh cannot produce a token", async () => {
    const fetchMock = vi.fn<FetchCall>(async () =>
      json({ error: "ExpiredToken" }, 401),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new MainApiTransport();
    const refresh = vi.fn<() => Promise<null>>(async () => null);
    transport.setTokenRefreshCallback(refresh);

    const response = await transport.request("/test", {
      authentication: {
        type: "refreshable-dpop",
        token: unsafeAsAccessToken("expired-token"),
      },
    });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shares one refresh between concurrent expired requests", async () => {
    const fetchMock = vi.fn<FetchCall>(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        return authorization === "DPoP fresh-token"
          ? json({ ok: true })
          : json({ error: "ExpiredToken" }, 401);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new MainApiTransport();
    const refresh = vi.fn<RefreshCall>(async () => {
      await Promise.resolve();
      return unsafeAsAccessToken("fresh-token");
    });
    transport.setTokenRefreshCallback(refresh);
    const options = {
      authentication: {
        type: "refreshable-dpop" as const,
        token: unsafeAsAccessToken("expired-token"),
      },
    };

    const responses = await Promise.all([
      transport.request("/first", options),
      transport.request("/second", options),
    ]);

    expect(responses.every((response) => response.ok)).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a stream body or a refresh returning the same token", async () => {
    const fetchMock = vi.fn<FetchCall>(async () =>
      json({ error: "ExpiredToken" }, 401),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new MainApiTransport();
    const token = unsafeAsAccessToken("same-token");
    const refresh = vi.fn<RefreshCall>(async () => token);
    transport.setTokenRefreshCallback(refresh);

    await transport.request("/stream", {
      method: "POST",
      body: new ReadableStream(),
      authentication: { type: "refreshable-dpop", token },
    });
    await transport.request("/same", {
      authentication: { type: "refreshable-dpop", token },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("preserves API error metadata and rate-limit wording", async () => {
    const transport = new MainApiTransport();
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () =>
        json(
          {
            error: "ReauthRequired",
            message: "Authenticate again",
            did: "did:plc:test",
            reauthMethods: ["passkey"],
          },
          403,
        ),
      ),
    );

    const error = await transport
      .requestJson("/test")
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      error: "ReauthRequired",
      message: "Authenticate again",
      did: "did:plc:test",
      reauthMethods: ["passkey"],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () => json({ error: "Unknown" }, 429)),
    );
    await expect(transport.requestJson("/limited")).rejects.toThrow(
      "Too many requests. Please try again later.",
    );
  });

  it("accepts any successful 2xx response for raw requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () => json({ accepted: true }, 202)),
    );

    await expect(
      new MainApiTransport().requestJson<{ accepted: boolean }>("/accepted"),
    ).resolves.toEqual({ accepted: true });
  });
});
