import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CommunicationPreviewPage } from "./CommunicationPreviewPage.tsx";

describe("CommunicationPreviewPage", () => {
  it("updates preferences using the local preview API", async () => {
    const user = userEvent.setup();
    render(<CommunicationPreviewPage />);

    expect(
      await screen.findByText("New sign-in to your account"),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Preferred channel"),
      "discord",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Communication preferences saved"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Preferred channel")).toHaveValue("discord"),
    );
  });

  it("opens channel verification in a dialog", async () => {
    const user = userEvent.setup();
    render(<CommunicationPreviewPage />);

    const telegram = await screen.findByLabelText("Telegram Username");
    await user.type(telegram, "alice_preview");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("dialog", { name: "Verify Telegram" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Telegram to verify" }),
    ).toBeInTheDocument();
  });
});
