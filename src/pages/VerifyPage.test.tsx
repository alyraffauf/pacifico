import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyPage } from "./VerifyPage.tsx";

const mocks = vi.hoisted(() => ({
  describeServer: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  checkChannelVerified: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  verifyToken: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../lib/api.ts", () => ({
  ApiError: class ApiError extends Error {},
  api: mocks,
}));

vi.mock("../lib/auth.ts", () => ({
  confirmSignup: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  resendVerification: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../hooks/useAuthState.ts", () => ({
  useAuthState: () => ({ kind: "unauthenticated" }),
}));

describe("verification page", () => {
  beforeEach(() => {
    mocks.describeServer.mockResolvedValue({
      telegramBotUsername: "tranquil_bot",
    });
    mocks.checkChannelVerified.mockResolvedValue({ verified: false });
    mocks.verifyToken.mockResolvedValue({
      purpose: "migration",
      channel: "email",
    });
  });

  it("recognizes a completed email authorization link", () => {
    render(
      <MemoryRouter
        initialEntries={["/app/verify?type=email-authorize-success"]}
      >
        <VerifyPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Email change authorized" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to settings" }),
    ).toHaveAttribute("href", "/app/settings");
  });

  it("automatically submits a token link that includes its identifier", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/app/verify?token=test-token&identifier=alice%40example.com",
        ]}
      >
        <VerifyPage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(mocks.verifyToken).toHaveBeenCalledWith(
        "test-token",
        "alice@example.com",
        undefined,
      ),
    );
    expect(
      await screen.findByText("Verification complete for email."),
    ).toBeInTheDocument();
  });

  it("restores signup verification from query parameters and uses the bot flow", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/app/verify?did=did%3Aplc%3Aalice&handle=alice.example.com&channel=telegram",
        ]}
      >
        <VerifyPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("link", { name: "Open Telegram to verify" }),
    ).toHaveAttribute(
      "href",
      "https://t.me/tranquil_bot?start=alice_example_com",
    );
    expect(
      JSON.parse(
        localStorage.getItem("tranquil_pds_pending_verification") ?? "null",
      ),
    ).toEqual({
      did: "did:plc:alice",
      handle: "alice.example.com",
      channel: "telegram",
    });
    expect(
      screen.queryByLabelText("Verification code"),
    ).not.toBeInTheDocument();
  });
});
