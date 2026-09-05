import { describe, expect, it } from "vitest";
import {
  clearRegistrationState,
  loadRegistrationState,
  saveRegistrationState,
} from "./storage.ts";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsHandle,
  unsafeAsRefreshToken,
} from "../types/branded.ts";

describe("registration recovery storage", () => {
  it("restores an interrupted passkey registration without storing a password", () => {
    saveRegistrationState(
      "passkey",
      "app-password",
      "pds.example.com",
      {
        handle: "alice",
        email: "alice@example.com",
        password: "must-not-be-stored",
        didType: "web-external",
        externalDid: "did:web:alice.example.com",
        verificationChannel: "email",
      },
      { keyMode: "byod", byodPrivateKey: new Uint8Array([1, 2, 3]) },
      {
        did: unsafeAsDid("did:web:alice.example.com"),
        handle: unsafeAsHandle("alice.pds.example.com"),
        appPassword: "one-time-password",
      },
      {
        accessJwt: unsafeAsAccessToken("access-token"),
        refreshJwt: unsafeAsRefreshToken("refresh-token"),
      },
    );

    const restored = loadRegistrationState();
    expect(restored?.info.password).toBeUndefined();
    expect(restored?.externalDidWeb.byodPrivateKey).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(restored?.account?.appPassword).toBe("one-time-password");
  });

  it("clears recovery state after its one-hour lifetime", () => {
    localStorage.setItem(
      "tranquil_registration_state",
      JSON.stringify({
        version: 1,
        startedAt: new Date(Date.now() - 60 * 60 * 1000 - 1).toISOString(),
      }),
    );

    expect(loadRegistrationState()).toBeNull();
    expect(localStorage.getItem("tranquil_registration_state")).toBeNull();
  });

  it("clears recovery state explicitly", () => {
    localStorage.setItem("tranquil_registration_state", "{}");
    clearRegistrationState();
    expect(localStorage.getItem("tranquil_registration_state")).toBeNull();
  });
});
