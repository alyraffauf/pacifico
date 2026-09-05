import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "./ui.tsx";

describe("DashboardPage", () => {
  it("keeps dashboard content on the shared settings width", () => {
    render(
      <DashboardPage
        title="Security"
        description="Manage account security."
        busy
      >
        <p>Page content</p>
      </DashboardPage>,
    );

    const heading = screen.getByRole("heading", { name: "Security" });
    const page = heading.parentElement?.parentElement?.parentElement;

    expect(page).toHaveClass("max-w-[52rem]");
    expect(page).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Page content")).toBeVisible();
  });
});
