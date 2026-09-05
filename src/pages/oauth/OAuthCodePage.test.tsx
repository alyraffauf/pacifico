import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { OAuthCodePage } from "./OAuthCodePage.tsx";

describe("OAuth verification codes", () => {
  it("submits delegated TOTP to Tranquil's delegation endpoint", async () => {
    const requestUri = "urn:ietf:params:oauth:request_uri:test";
    window.history.replaceState(
      {},
      "",
      `/?request_uri=${encodeURIComponent(requestUri)}`,
    );
    const fetchMock = vi.fn<() => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ error: "test-stop" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter
        initialEntries={[
          `/app/oauth/delegation-totp?request_uri=${encodeURIComponent(requestUri)}`,
        ]}
      >
        <OAuthCodePage />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Authenticator or backup code"),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/oauth/delegation/totp",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ request_uri: requestUri, code: "123456" }),
        }),
      ),
    );
  });
});
