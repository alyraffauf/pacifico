import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MigrationChooser, MigrationResumeView } from "./MigrationViews.tsx";

describe("migration views", () => {
  it("selects either migration direction", async () => {
    const onInbound = vi.fn<() => void>();
    const onOffline = vi.fn<() => void>();
    render(
      <MemoryRouter>
        <MigrationChooser onInbound={onInbound} onOffline={onOffline} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: /Move from another PDS/ }),
    );
    await user.click(
      screen.getByRole("button", { name: /Restore an offline backup/ }),
    );

    expect(onInbound).toHaveBeenCalledOnce();
    expect(onOffline).toHaveBeenCalledOnce();
  });

  it("shows saved inbound migration details", () => {
    render(
      <MemoryRouter>
        <MigrationResumeView
          pending={{
            direction: "inbound",
            sourceHandle: "old.example",
            targetHandle: "new.example",
            progressSummary: "Repository copied",
          }}
          busy={false}
          onResume={vi.fn<() => void>()}
          onStartOver={vi.fn<() => void>()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("@old.example")).toBeInTheDocument();
    expect(screen.getByText("@new.example")).toBeInTheDocument();
    expect(screen.getByText("Repository copied")).toBeInTheDocument();
  });
});
