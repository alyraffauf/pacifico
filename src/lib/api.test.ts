import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsHandle,
} from "./types/branded.ts";

vi.mock("./oauth.ts", () => ({
  createDPoPProofForRequest: vi.fn<
    (method: string, url: string, token: string) => Promise<string>
  >(async () => "proof"),
  setDPoPNonce: vi.fn<(nonce: string) => void>(),
}));

import { api, ApiError } from "./api.ts";

type FetchCall = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api façade", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () => json({})),
    );
  });

  it("uses atcute for standard JSON calls and keeps response extensions", async () => {
    const fetchMock = vi.fn<FetchCall>(async (input) => {
      expect(String(input)).toBe("/xrpc/com.atproto.server.createSession");
      return json({
        did: "did:plc:test",
        handle: "alice.test",
        accessJwt: "access",
        refreshJwt: "refresh",
        preferredChannel: "signal",
        preferredChannelVerified: true,
        preferredLocale: "fi",
        isAdmin: true,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await api.createSession("alice.test", "password");

    expect(session).toMatchObject({
      did: "did:plc:test",
      preferredChannel: "signal",
      preferredLocale: "fi",
      isAdmin: true,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      identifier: "alice.test",
      password: "password",
    });
    expect(new Headers(init.headers).has("Atproto-Proxy")).toBe(false);
  });

  it.each([
    [
      "createAppPassword",
      () =>
        api.createAppPassword(
          unsafeAsAccessToken("access"),
          "mobile",
          "repo:read",
        ),
      "/xrpc/com.atproto.server.createAppPassword",
      { name: "mobile", scopes: "repo:read" },
    ],
    [
      "requestEmailUpdate",
      () =>
        api.requestEmailUpdate(
          unsafeAsAccessToken("access"),
          "new@example.com",
        ),
      "/xrpc/com.atproto.server.requestEmailUpdate",
      { newEmail: "new@example.com" },
    ],
  ])(
    "keeps extended %s inputs on the raw transport",
    async (_name, call, url, body) => {
      const fetchMock = vi.fn<FetchCall>(async () =>
        json({ scopes: "repo:read" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await call();

      expect(fetchMock.mock.calls[0]?.[0]).toBe(url);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual(body);
    },
  );

  it("keeps the extended account search handle query", async () => {
    const fetchMock = vi.fn<FetchCall>(async () => json({ accounts: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.searchAccounts(unsafeAsAccessToken("access"), {
      handle: "alice",
      cursor: "next",
      limit: 25,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/xrpc/com.atproto.admin.searchAccounts?handle=alice&cursor=next&limit=25",
    );
  });

  it("preserves uploaded media types and CAR bytes", async () => {
    const fetchMock = vi
      .fn<FetchCall>()
      .mockResolvedValueOnce(json({ blob: { mimeType: "image/png" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const image = new File([new Uint8Array([1, 2])], "image.png", {
      type: "image/png",
    });
    const car = new Uint8Array([3, 4, 5]);

    await api.uploadBlob(unsafeAsAccessToken("access"), image);
    await api.importRepo(unsafeAsAccessToken("access"), car);

    const uploadInit = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(uploadInit?.headers).get("content-type")).toBe(
      "image/png",
    );
    expect(uploadInit?.body).toBe(image);
    const importInit = fetchMock.mock.calls[1]?.[1];
    expect(new Headers(importInit?.headers).get("content-type")).toBe(
      "application/vnd.ipld.car",
    );
    expect(importInit?.body).toBe(car);
  });

  it("returns a tightly sliced ArrayBuffer from getRepo", async () => {
    const source = new Uint8Array([9, 1, 2, 8]);
    const view = source.subarray(1, 3);
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () => new Response(view, { status: 200 })),
    );

    const result = await api.getRepo(
      unsafeAsAccessToken("access"),
      unsafeAsDid("did:plc:test"),
    );

    expect([...new Uint8Array(result)]).toEqual([1, 2]);
    expect(result.byteLength).toBe(2);
  });

  it("normalizes atcute failures into the shared ApiError class", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () =>
        json(
          {
            error: "ReauthRequired",
            message: "Sign in again",
            did: "did:plc:test",
            reauthMethods: ["password", "passkey"],
          },
          401,
        ),
      ),
    );

    const error = await api
      .getAccountInfo(
        unsafeAsAccessToken("access"),
        unsafeAsDid("did:plc:test"),
      )
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      did: "did:plc:test",
      reauthMethods: ["password", "passkey"],
    });
  });

  it("wraps raw XRPC network failures as status-zero results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const result = await api.getDelegationScopePresets();

    expect(result.ok).toBe(false);
    const error = result.ok ? undefined : result.error;
    expect(error).toMatchObject({
      status: 0,
      error: "Unknown",
      message: "fetch failed",
    });
  });

  it("resolves handles through the local XRPC route", async () => {
    const fetchMock = vi.fn<FetchCall>(async () =>
      json({ did: "did:plc:controller" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.resolveHandle("controller.test")).resolves.toEqual({
      did: "did:plc:controller",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/xrpc/com.atproto.identity.resolveHandle?handle=controller.test",
    );
  });

  it("uses the exact delegated authorization payload", async () => {
    const fetchMock = vi
      .fn<FetchCall>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_dpop_proof" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
            "DPoP-Nonce": "delegation-nonce",
          },
        }),
      )
      .mockResolvedValueOnce(
        json({ success: true, redirect_uri: "https://client.test/callback" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await api.authorizeDelegatedSession(
      unsafeAsAccessToken("access"),
      "urn:ietf:params:oauth:request_uri:test",
      unsafeAsDid("did:plc:delegate"),
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/oauth/delegation/auth-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      request_uri: "urn:ietf:params:oauth:request_uri:test",
      delegated_did: "did:plc:delegate",
    });
  });

  it("keeps service-auth account creation on Bearer authentication", async () => {
    const fetchMock = vi.fn<FetchCall>(async () =>
      json({
        did: "did:plc:test",
        handle: "alice.test",
        accessJwt: "access",
        refreshJwt: "refresh",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createAccountWithServiceAuth("service", {
      did: unsafeAsDid("did:plc:test"),
      handle: unsafeAsHandle("alice.test"),
      password: "password",
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer service");
    expect(headers.has("dpop")).toBe(false);
  });
});
