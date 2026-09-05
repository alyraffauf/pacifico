import { describe, expect, it } from "vitest";
import {
  getAuthorizationDestination,
  getOAuthCodeEndpoint,
  getOAuthCodeMode,
} from "./oauth-flow.ts";

describe("OAuth flow routing", () => {
  it("accepts Tranquil's delegated-account redirect response", () => {
    expect(
      getAuthorizationDestination(
        {
          redirect:
            "/app/oauth/delegation?request_uri=abc&delegated_did=did%3Aplc%3Aalice",
        },
        "urn:request:abc",
      )?.startsWith("/app/oauth/delegation?"),
    ).toBe(true);
  });

  it("routes ordinary TOTP challenges", () => {
    expect(
      getAuthorizationDestination({ needs_totp: true }, "urn:request:abc"),
    ).toBe("/app/oauth/totp?request_uri=urn%3Arequest%3Aabc");
  });

  it("uses the delegation endpoint for delegation TOTP", () => {
    const mode = getOAuthCodeMode("/app/oauth/delegation-totp");
    expect(mode).toBe("delegation-totp");
    expect(getOAuthCodeEndpoint(mode)).toBe("/oauth/delegation/totp");
  });
});
