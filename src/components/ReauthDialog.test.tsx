import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReauthDialog } from "./ReauthDialog.tsx";

describe("ReauthDialog", () => {
  it("focuses the dialog, cancels with Escape, and restores focus", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onCancel = vi.fn<() => void>();

    const { unmount } = render(
      <ReauthDialog
        methods={["password"]}
        onCancel={onCancel}
        onSuccess={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByLabelText("Password")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
