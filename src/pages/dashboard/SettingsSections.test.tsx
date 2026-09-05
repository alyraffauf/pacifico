import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { useTranslation } from "../../lib/i18n.ts";
import { SettingsSections } from "./SettingsSections.tsx";

type Props = ComponentProps<typeof SettingsSections>;

function props(overrides: Partial<Props> = {}): Props {
  return {
    t: ((key: string) => key) as ReturnType<typeof useTranslation>,
    activeEditor: null,
    setActiveEditor: vi.fn<Props["setActiveEditor"]>(),
    cancelHandleEditor: vi.fn<Props["cancelHandleEditor"]>(),
    cancelEmailEditor: vi.fn<Props["cancelEmailEditor"]>(),
    sessionHandle: "alice.example.com",
    sessionDid: "did:plc:alice",
    sessionEmail: "alice@example.com",
    customHandle: false,
    setCustomHandle: vi.fn<Props["setCustomHandle"]>(),
    handle: "alice",
    setHandle: vi.fn<Props["setHandle"]>(),
    selectedDomain: "example.com",
    setSelectedDomain: vi.fn<Props["setSelectedDomain"]>(),
    availableDomains: ["example.com"],
    saving: false,
    canSaveHandle: true,
    saveHandle: vi.fn<Props["saveHandle"]>(),
    email: "new@example.com",
    changeEmailInput: vi.fn<Props["changeEmailInput"]>(),
    emailInUse: false,
    emailToken: "",
    setEmailToken: vi.fn<Props["setEmailToken"]>(),
    emailTokenRequired: false,
    emailUpdateAuthorized: false,
    checkEmailAvailability: vi.fn<Props["checkEmailAvailability"]>(() =>
      Promise.resolve(),
    ),
    saveEmail: vi.fn<Props["saveEmail"]>(),
    locale: "en",
    changeLocale: vi.fn<Props["changeLocale"]>(() => Promise.resolve()),
    legacyLogin: false,
    changeLegacyLogin: vi.fn<Props["changeLegacyLogin"]>(() =>
      Promise.resolve(),
    ),
    hasMfa: true,
    deleteRequested: false,
    deleteToken: "",
    setDeleteToken: vi.fn<Props["setDeleteToken"]>(),
    deletePassword: "",
    setDeletePassword: vi.fn<Props["setDeletePassword"]>(),
    requestDelete: vi.fn<Props["requestDelete"]>(() => Promise.resolve()),
    deleteAccount: vi.fn<Props["deleteAccount"]>(),
    ...overrides,
  };
}

describe("SettingsSections", () => {
  it("shows account values before either editor", () => {
    render(<SettingsSections {...props()} />);

    expect(screen.getByText("@alice.example.com")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("did:plc:alice")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "settings.newHandle" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "settings.newEmail" }),
    ).not.toBeInTheDocument();
  });

  it("opens either editor and cancels it", () => {
    const setActiveEditor = vi.fn<Props["setActiveEditor"]>();
    const cancelHandleEditor = vi.fn<Props["cancelHandleEditor"]>();
    const cancelEmailEditor = vi.fn<Props["cancelEmailEditor"]>();
    const { rerender } = render(
      <SettingsSections
        {...props({ setActiveEditor, cancelHandleEditor, cancelEmailEditor })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "settings.changeHandleButton" }),
    );
    expect(setActiveEditor).toHaveBeenCalledWith("handle");

    rerender(
      <SettingsSections
        {...props({
          activeEditor: "handle",
          setActiveEditor,
          cancelHandleEditor,
          cancelEmailEditor,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(cancelHandleEditor).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: "settings.changeEmailButton" }),
    );
    expect(setActiveEditor).toHaveBeenCalledWith("email");
  });

  it("exposes handle choices as pressed buttons and labels the suffix", () => {
    const setCustomHandle = vi.fn<Props["setCustomHandle"]>();
    render(
      <SettingsSections
        {...props({ activeEditor: "handle", setCustomHandle })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "settings.pdsHandle" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "settings.customDomain" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("combobox", { name: "settings.domainSuffix" }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", { name: "settings.customDomain" }),
    );
    expect(setCustomHandle).toHaveBeenCalledWith(true);
  });

  it("updates language and retains the MFA-dependent legacy login control", () => {
    const changeLocale = vi.fn<Props["changeLocale"]>(() => Promise.resolve());
    const changeLegacyLogin = vi.fn<Props["changeLegacyLogin"]>(() =>
      Promise.resolve(),
    );
    const { rerender } = render(
      <SettingsSections {...props({ changeLocale, changeLegacyLogin })} />,
    );

    const languageSelect = screen.getByRole("combobox", {
      name: "settings.language",
    });
    expect(languageSelect.parentElement).toHaveClass("max-w-64");
    fireEvent.change(languageSelect, { target: { value: "fr" } });
    expect(changeLocale).toHaveBeenCalledWith("fr");
    fireEvent.click(
      screen.getByRole("switch", { name: "settings.passwordSignIn" }),
    );
    expect(changeLegacyLogin).toHaveBeenCalledWith(true);

    rerender(<SettingsSections {...props({ hasMfa: false })} />);
    expect(
      screen.getByRole("switch", { name: "settings.passwordSignIn" }),
    ).toBeDisabled();
    expect(screen.getByText("settings.legacyMfaRequired")).toBeInTheDocument();
  });

  it("copies the DID and announces feedback", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    render(<SettingsSections {...props()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "common.copyToClipboard" }),
    );

    expect(writeText).toHaveBeenCalledWith("did:plc:alice");
    await waitFor(() =>
      expect(screen.getByText("settings.didCopied")).toBeInTheDocument(),
    );
  });

  it("reveals deletion fields only after a deletion request", () => {
    const requestDelete = vi.fn<Props["requestDelete"]>(() =>
      Promise.resolve(),
    );
    const { rerender } = render(
      <SettingsSections {...props({ requestDelete })} />,
    );

    expect(
      screen.queryByRole("textbox", { name: "settings.confirmationCode" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "settings.requestDeletion" }),
    );
    expect(requestDelete).toHaveBeenCalledOnce();

    rerender(<SettingsSections {...props({ deleteRequested: true })} />);
    expect(
      screen.getByRole("textbox", { name: "settings.confirmationCode" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("settings.yourPassword")).toBeInTheDocument();
  });
});
