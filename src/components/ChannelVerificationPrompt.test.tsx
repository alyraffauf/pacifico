import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ChannelVerificationPrompt,
  hasBotVerification,
} from "./ChannelVerificationPrompt.tsx";

describe("channel verification prompts", () => {
  it("always treats Discord and Telegram as bot verification channels", () => {
    expect(hasBotVerification("discord")).toBe(true);
    expect(hasBotVerification("telegram")).toBe(true);
    expect(hasBotVerification("signal")).toBe(false);
    expect(hasBotVerification("email")).toBe(false);
  });

  it("builds the Telegram deep link using the account handle", () => {
    render(
      <ChannelVerificationPrompt
        channel="telegram"
        handle="alice.example.com"
        server={{ telegramBotUsername: "tranquil_bot" }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Open Telegram to verify" }),
    ).toHaveAttribute(
      "href",
      "https://t.me/tranquil_bot?start=alice_example_com",
    );
  });

  it("keeps bot instructions usable when optional metadata is absent", () => {
    render(
      <ChannelVerificationPrompt
        channel="discord"
        handle="alice.example.com"
        server={{}}
      />,
    );
    expect(screen.getByText(/send/i)).toHaveTextContent(
      "/start alice.example.com",
    );
    expect(screen.getByText(/waiting for verification/i)).toBeInTheDocument();
  });
});
