import { describe, expect, it, vi } from "vitest";
import { denyAuthorization } from "./oauth-denial.ts";

describe("denyAuthorization", () => {
  it("uses the redirect URI returned in the backend JSON response", async () => {
    const send = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      Response.json({
        redirect_uri: "https://client.example/callback?error=access_denied",
      }),
    );

    await expect(denyAuthorization("urn:request:1", send)).resolves.toBe(
      "https://client.example/callback?error=access_denied",
    );
    expect(send).toHaveBeenCalledWith(
      "/oauth/authorize/deny",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ request_uri: "urn:request:1" }),
      }),
    );
  });

  it("rejects a successful response without a redirect URI", async () => {
    const send = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => Response.json({}));
    await expect(denyAuthorization("urn:request:1", send)).rejects.toThrow(
      "The authorization server returned no redirect.",
    );
  });
});
