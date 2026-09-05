import { beforeEach, describe, expect, it } from "vitest";
import { _testReset } from "../auth.ts";
import { persistSsoRegistrationSession } from "./sso-session.ts";

beforeEach(() => _testReset());

describe("SSO registration sessions", () => {
  it("stores complete sessions under the Tranquil session key", () => {
    expect(persistSsoRegistrationSession({
      did: "did:plc:alice",
      handle: "alice.example.com",
      accessJwt: "access-token",
      refreshJwt: "refresh-token",
    })).toBe(true);

    const stored = JSON.parse(localStorage.getItem("tranquil_pds_session") ?? "null");
    expect(stored).toMatchObject({
      did: "did:plc:alice",
      handle: "alice.example.com",
      accessJwt: "access-token",
      refreshJwt: "refresh-token",
    });
    expect(localStorage.getItem("accessJwt")).toBeNull();
    expect(localStorage.getItem("refreshJwt")).toBeNull();
  });

  it("does not persist incomplete token pairs", () => {
    expect(persistSsoRegistrationSession({
      did: "did:plc:alice",
      handle: "alice.example.com",
      accessJwt: "access-token",
    })).toBe(false);
    expect(localStorage.getItem("tranquil_pds_session")).toBeNull();
  });
});
