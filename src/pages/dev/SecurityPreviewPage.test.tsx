import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SecurityPreviewPage } from "./SecurityPreviewPage.tsx";

describe("SecurityPreviewPage", () => {
  it("opens security actions in dialogs without expanding the settings rows", async () => {
    const user = userEvent.setup();
    render(<SecurityPreviewPage />);

    const changePassword = await screen.findByRole("button", {
      name: "Change",
    });
    await user.click(changePassword);
    const passwordDialog = screen.getByRole("dialog", {
      name: "Change password",
    });
    expect(passwordDialog).toHaveClass("relative");
    expect(passwordDialog).toHaveClass("max-h-[calc(100dvh-2rem)]");
    expect(passwordDialog.parentElement).toHaveClass(
      "grid",
      "h-dvh",
      "place-items-center",
      "overflow-hidden",
    );
    expect(changePassword).toHaveClass("min-h-11", "sm:min-h-9");
    expect(screen.getByLabelText("Current password")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Change password" }),
    ).not.toBeInTheDocument();
    expect(changePassword).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(
      screen.getByRole("dialog", { name: "Manage authenticator" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Add passkey" }));
    expect(
      screen.getByRole("dialog", { name: "Add a passkey" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Passkey name/)).toHaveFocus();
  });

  it("updates a passkey using the local preview API", async () => {
    const user = userEvent.setup();
    render(<SecurityPreviewPage />);

    expect(await screen.findByText("MacBook Pro")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /rename/i })[0]);
    const name = screen.getByDisplayValue("MacBook Pro");
    await user.clear(name);
    await user.type(name, "Work laptop");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Work laptop")).toBeInTheDocument();
    expect(screen.getByText("Passkey renamed.")).toBeInTheDocument();
  });
});
