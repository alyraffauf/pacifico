import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InviteCodesPreviewPage } from "./InviteCodesPreviewPage.tsx";

describe("InviteCodesPreviewPage", () => {
  it("creates an invite code using the local preview API", async () => {
    const user = userEvent.setup();
    render(<InviteCodesPreviewPage />);

    expect(
      await screen.findByText("pacifico-preview-available"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Create invite code" }),
    );

    expect(await screen.findAllByText("pacifico-preview-new-4")).toHaveLength(
      2,
    );
    expect(
      screen.getByRole("dialog", { name: "Invite Code Created" }),
    ).toBeInTheDocument();
  });

  it("asks before disabling an invite code", async () => {
    const user = userEvent.setup();
    render(<InviteCodesPreviewPage />);

    expect(
      await screen.findByText("pacifico-preview-available"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disable" }));
    const dialog = screen.getByRole("dialog", { name: "Disable" });
    expect(
      within(dialog).getByText(
        "Disable invite code pacifico-preview-available?",
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Disable" }));

    expect(screen.getByText("Invite code disabled")).toBeInTheDocument();
    const changedCode = screen.getByText("pacifico-preview-available");
    expect(
      within(changedCode.parentElement!).getByText("Disabled"),
    ).toBeInTheDocument();
  });
});
