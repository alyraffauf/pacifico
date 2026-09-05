import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SsoRegisterCompletePage } from "./SsoRegistrationPages.tsx";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SSO registration", () => {
  it("submits the DID choice accepted by Tranquil", async () => {
    window.history.replaceState(
      {},
      "",
      "/app/oauth/sso-register?token=test-token",
    );
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/oauth/sso/pending-registration?")) {
        return json({
          request_uri: "urn:request:test",
          provider: "oidc",
          provider_username: "alice",
          provider_email: "alice@example.com",
          provider_email_verified: true,
        });
      }
      if (url === "/xrpc/com.atproto.server.describeServer") {
        return json({
          availableUserDomains: ["pds.test"],
          inviteCodeRequired: false,
          availableCommsChannels: ["email"],
          selfHostedDidWebEnabled: true,
        });
      }
      if (url.startsWith("/oauth/sso/check-handle-available?"))
        return json({ available: true });
      if (
        url === "/oauth/sso/complete-registration" &&
        init?.method === "POST"
      ) {
        return json({
          did: "did:web:example.com",
          handle: "alice.pds.test",
          redirectUrl: "/app/verify",
          appPassword: "test-password",
          appPasswordName: "migration",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SsoRegisterCompletePage />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByLabelText("DID type"),
      "web-external",
    );
    await user.type(
      screen.getByLabelText("Existing DID"),
      "did:web:example.com",
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/oauth/sso/complete-registration",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"did_type":"web-external"'),
        }),
      ),
    );
    const request = fetchMock.mock.calls.find(
      ([input]) => input === "/oauth/sso/complete-registration",
    );
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      did_type: "web-external",
      did: "did:web:example.com",
    });
  });
});
