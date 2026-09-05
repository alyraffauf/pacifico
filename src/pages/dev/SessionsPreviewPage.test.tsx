import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SessionsPreviewPage } from "./SessionsPreviewPage.tsx";

describe("SessionsPreviewPage", () => {
  it("revokes a session using the local preview API", async () => {
    const user = userEvent.setup();
    render(<SessionsPreviewPage />);

    expect(await screen.findByText("Skywriter")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Revoke" })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("Skywriter")).toHaveLength(2);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Revoke",
      }),
    );

    expect(screen.queryByText("Skywriter")).not.toBeInTheDocument();
    expect(screen.getByText("Session revoked")).toBeInTheDocument();
  });
});
