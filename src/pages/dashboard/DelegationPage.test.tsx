import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api.ts";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsISODate,
  unsafeAsRefreshToken,
  unsafeAsScopeSet,
} from "../../lib/types/branded.ts";
import type {
  DelegationControlledAccount,
  DelegationController,
  Session,
} from "../../lib/types/api.ts";
import { ok } from "../../lib/types/result.ts";
import { DelegationPage } from "./DelegationPage.tsx";

const session: Session = {
  did: unsafeAsDid("did:plc:account"),
  handle: unsafeAsHandle("alice.example.com"),
  accessJwt: unsafeAsAccessToken("access-token"),
  refreshJwt: unsafeAsRefreshToken("refresh-token"),
  contactKind: "email",
  email: unsafeAsEmail("alice@example.com"),
  emailConfirmed: true,
  accountKind: "active",
  isAdmin: false,
};

const controller: DelegationController = {
  did: unsafeAsDid("did:plc:controller"),
  handle: unsafeAsHandle("bob.example.com"),
  grantedScopes: unsafeAsScopeSet("owner"),
  grantedAt: unsafeAsISODate("2026-08-20T14:30:00.000Z"),
  isActive: true,
  isLocal: true,
};

const managedAccount: DelegationControlledAccount = {
  did: unsafeAsDid("did:plc:managed"),
  handle: unsafeAsHandle("studio.example.com"),
  grantedScopes: unsafeAsScopeSet("owner"),
  grantedAt: unsafeAsISODate("2026-08-20T14:30:00.000Z"),
};

function mockDelegationData({
  controllers = [],
  accounts = [],
}: {
  controllers?: DelegationController[];
  accounts?: DelegationControlledAccount[];
} = {}) {
  vi.spyOn(api, "listDelegationControllers").mockResolvedValue(
    ok({ controllers }),
  );
  vi.spyOn(api, "listDelegationControlledAccounts").mockResolvedValue(
    ok({ accounts }),
  );
  vi.spyOn(api, "getDelegationScopePresets").mockResolvedValue(
    ok({
      presets: [
        {
          name: "owner",
          scopes: unsafeAsScopeSet("owner"),
          description: "Manage settings and content",
        },
        {
          name: "viewer",
          scopes: unsafeAsScopeSet("viewer"),
          description: "View account data",
        },
      ],
    }),
  );
  vi.spyOn(api, "getDelegationAuditLog").mockResolvedValue(
    ok({ entries: [], total: 0 }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={session} />}>
          <Route index element={<DelegationPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("DelegationPage", () => {
  beforeEach(() => {
    mockDelegationData();
  });

  it("resolves and adds a controller after explicit acknowledgment", async () => {
    const user = userEvent.setup();
    const resolveController = vi
      .spyOn(api, "resolveController")
      .mockResolvedValue(
        ok({
          did: "did:plc:controller",
          handle: "bob.example.com",
          pdsUrl: "https://example.com",
          isLocal: true,
        }),
      );
    const addController = vi
      .spyOn(api, "addDelegationController")
      .mockResolvedValue(ok({ success: true }));

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Add controller" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add controller" });
    await user.type(
      within(dialog).getByLabelText("Controller handle or DID"),
      "@bob.example.com",
    );
    await user.click(within(dialog).getByRole("button", { name: "Find" }));

    expect(resolveController).toHaveBeenCalledWith("bob.example.com");
    expect(await within(dialog).findByText("@bob.example.com")).toBeVisible();
    const submit = within(dialog).getByRole("button", {
      name: "Add controller",
    });
    expect(submit).toBeDisabled();

    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /I understand that I will no longer be able to log in directly/,
      }),
    );
    await user.click(submit);

    await waitFor(() =>
      expect(addController).toHaveBeenCalledWith(
        session.accessJwt,
        unsafeAsDid("did:plc:controller"),
        unsafeAsScopeSet("owner"),
      ),
    );
    expect(
      await screen.findByText("Controller added successfully"),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates a managed account in a dialog", async () => {
    const user = userEvent.setup();
    const createAccount = vi
      .spyOn(api, "createDelegatedAccount")
      .mockResolvedValue(
        ok({
          did: unsafeAsDid("did:plc:new-account"),
          handle: unsafeAsHandle("team.example.com"),
        }),
      );

    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: "Create account",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Create delegated account",
    });
    await user.type(
      within(dialog).getByLabelText("Handle"),
      "team.example.com",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    await waitFor(() =>
      expect(createAccount).toHaveBeenCalledWith(
        session.accessJwt,
        unsafeAsHandle("team.example.com"),
        undefined,
        unsafeAsScopeSet("owner"),
      ),
    );
    expect(
      await screen.findByText("Created delegated account: team.example.com"),
    ).toBeVisible();
  });

  it("shows the restriction only for the unavailable relationship", async () => {
    mockDelegationData({ controllers: [controller] });
    renderPage();

    expect(await screen.findByText("@bob.example.com")).toBeVisible();
    expect(screen.getByText("Managed accounts are unavailable")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create account" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add controller" }),
    ).toBeVisible();
  });

  it("confirms controller removal in a dialog", async () => {
    const user = userEvent.setup();
    mockDelegationData({ controllers: [controller] });
    const removeController = vi
      .spyOn(api, "removeDelegationController")
      .mockResolvedValue(ok({ success: true }));

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", {
      name: "Remove controller",
    });
    expect(within(dialog).getByText("@bob.example.com")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(removeController).toHaveBeenCalledWith(
        session.accessJwt,
        controller.did,
      ),
    );
    expect(
      await screen.findByText("Controller removed successfully"),
    ).toBeVisible();
  });

  it("hides controller creation when this account manages another account", async () => {
    mockDelegationData({ accounts: [managedAccount] });
    renderPage();

    expect(await screen.findByText("@studio.example.com")).toBeVisible();
    expect(screen.getByText("Controller access is unavailable")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add controller" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeVisible();
  });
});
