import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppPasswordsPreviewPage } from "./AppPasswordsPreviewPage.tsx";

describe("AppPasswordsPreviewPage", () => {
  it("creates an app password using the local preview API", async () => {
    const user = userEvent.setup();
    render(<AppPasswordsPreviewPage />);

    expect(await screen.findByText("Skyfeed on laptop")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Create an app password" }),
    );
    const createDialog = screen.getByRole("dialog", {
      name: "Create an app password",
    });
    await user.type(within(createDialog).getByLabelText("Name"), "Test client");
    await user.click(
      within(createDialog).getByRole("button", { name: "Create" }),
    );

    expect(
      await screen.findByText("preview-only-password-7h3k"),
    ).toBeInTheDocument();
    expect(screen.getByText("Test client")).toBeInTheDocument();
    const createdDialog = screen.getByRole("dialog", {
      name: "App Password Created",
    });
    const doneButton = within(createdDialog).getByRole("button", {
      name: "Done",
    });
    expect(doneButton).toBeDisabled();
    await user.click(
      within(createdDialog).getByRole("checkbox", {
        name: "I have saved my app password in a secure location",
      }),
    );
    expect(doneButton).toBeEnabled();
  });

  it("asks before revoking an app password", async () => {
    const user = userEvent.setup();
    render(<AppPasswordsPreviewPage />);

    expect(await screen.findByText("Skyfeed on laptop")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Revoke" })[0]);
    const revokeDialog = screen.getByRole("dialog", {
      name: "Revoke app password",
    });
    expect(
      within(revokeDialog).getByText(
        'Revoke app password "Skyfeed on laptop"?',
      ),
    ).toBeInTheDocument();
    await user.click(
      within(revokeDialog).getByRole("button", { name: "Revoke" }),
    );

    expect(screen.queryByText("Skyfeed on laptop")).not.toBeInTheDocument();
    expect(screen.getByText("App password revoked")).toBeInTheDocument();
  });
});
