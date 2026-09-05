import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { OAuthLoginPage } from "./OAuthLoginPage.tsx";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OAuth login", () => {
  it("redirects delegated accounts before asking for a password", async () => {
    const requestUri = "urn:ietf:params:oauth:request_uri:test";
    window.history.replaceState(
      {},
      "",
      `/?request_uri=${encodeURIComponent(requestUri)}`,
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/oauth/authorize?"))
        return json({ client_name: "Test client" });
      if (url === "/oauth/sso/providers") return json({ providers: [] });
      if (url.startsWith("/oauth/security-status?")) {
        return json({ isDelegated: true, did: "did:plc:alice" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter
        initialEntries={[
          `/app/oauth/login?request_uri=${encodeURIComponent(requestUri)}`,
        ]}
      >
        <Routes>
          <Route path="/app/oauth/login" element={<OAuthLoginPage />} />
          <Route
            path="/app/oauth/delegation"
            element={<h1>Delegation login</h1>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent
      .setup()
      .type(screen.getByLabelText("Handle or email"), "alice.example.com");

    expect(
      await screen.findByRole("heading", { name: "Delegation login" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/oauth/security-status?identifier=alice.example.com",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("preserves Tranquil's pending verification data", async () => {
    const requestUri = "urn:ietf:params:oauth:request_uri:test";
    window.history.replaceState(
      {},
      "",
      `/?request_uri=${encodeURIComponent(requestUri)}`,
    );
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("/oauth/authorize?") && !init?.method)
          return json({});
        if (url === "/oauth/sso/providers") return json({ providers: [] });
        if (url.startsWith("/oauth/security-status?"))
          return json({ isDelegated: false });
        if (url === "/oauth/authorize" && init?.method === "POST") {
          return json(
            {
              error: "account_not_verified",
              did: "did:plc:alice",
              handle: "alice.example.com",
              channel: "email",
            },
            403,
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <OAuthLoginPage />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Handle or email"),
      "alice.example.com",
    );
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("link", { name: "Verify your account" }),
    ).toHaveAttribute(
      "href",
      `/app/verify?request_uri=${encodeURIComponent(requestUri)}`,
    );
    expect(
      JSON.parse(
        localStorage.getItem("tranquil_pds_pending_verification") ?? "null",
      ),
    ).toEqual({
      did: "did:plc:alice",
      handle: "alice.example.com",
      channel: "email",
    });
  });

  it("follows Tranquil's delegated-account redirect response", async () => {
    const requestUri = "urn:ietf:params:oauth:request_uri:test";
    window.history.replaceState(
      {},
      "",
      `/?request_uri=${encodeURIComponent(requestUri)}`,
    );
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("/oauth/authorize?") && !init?.method) {
          return json({ client_name: "Test client" });
        }
        if (url === "/oauth/sso/providers") return json({ providers: [] });
        if (url === "/oauth/authorize" && init?.method === "POST") {
          return json({
            next: "delegation",
            redirect: `/app/oauth/delegation?request_uri=${encodeURIComponent(requestUri)}&delegated_did=did%3Aplc%3Aalice`,
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter
        initialEntries={[
          `/app/oauth/login?request_uri=${encodeURIComponent(requestUri)}`,
        ]}
      >
        <Routes>
          <Route path="/app/oauth/login" element={<OAuthLoginPage />} />
          <Route
            path="/app/oauth/delegation"
            element={<h1>Delegation login</h1>}
          />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Handle or email"),
      "alice.example.com",
    );
    await user.type(
      screen.getByLabelText("Password"),
      "not-used-for-delegation",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("heading", { name: "Delegation login" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/oauth/authorize",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
