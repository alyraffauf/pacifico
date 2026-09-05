import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DelegationPreviewPage } from "./DelegationPreviewPage.tsx";

describe("DelegationPreviewPage", () => {
  it("creates a managed account using the local preview API", async () => {
    const user = userEvent.setup();
    render(<DelegationPreviewPage />);

    expect(
      await screen.findByText("@studio.pacifico.test"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const dialog = screen.getByRole("dialog", {
      name: "Create delegated account",
    });
    await user.type(
      within(dialog).getByLabelText("Handle"),
      "team.pacifico.test",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    expect(
      await screen.findByText("Created delegated account: team.pacifico.test"),
    ).toBeInTheDocument();
    expect(screen.getByText("@team.pacifico.test")).toBeInTheDocument();
  });
});
