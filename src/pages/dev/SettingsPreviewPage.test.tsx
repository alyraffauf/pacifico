import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SettingsPreviewPage } from "./SettingsPreviewPage.tsx";

describe("SettingsPreviewPage", () => {
  it("previews handle changes without a backend", async () => {
    render(<SettingsPreviewPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Change Handle" }));
    await user.type(screen.getByLabelText("New Handle"), "bob");
    const changeButtons = screen.getAllByRole("button", {
      name: "Change Handle",
    });
    await user.click(changeButtons.at(-1)!);

    expect(screen.getByText("@bob.pacifico.test")).toBeInTheDocument();
    expect(screen.getByText("Preview handle updated.")).toBeInTheDocument();
  });
});
