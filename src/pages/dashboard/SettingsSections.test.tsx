import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsSections } from "./SettingsSections.tsx";
import type { useTranslation } from "../../lib/i18n.ts";

type Props = ComponentProps<typeof SettingsSections>;

function props(overrides: Partial<Props> = {}): Props {
  return {
    t: ((key: string) => key) as ReturnType<typeof useTranslation>,
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
    saveHandle: vi.fn<(event: React.FormEvent<HTMLFormElement>) => void>(),
    email: "",
    changeEmailInput: vi.fn<(email: string) => void>(),
    emailInUse: false,
    emailToken: "",
    setEmailToken: vi.fn<Props["setEmailToken"]>(),
    emailTokenRequired: false,
    emailUpdateAuthorized: false,
    checkEmailAvailability: vi.fn<() => Promise<void>>(),
    saveEmail: vi.fn<(event: React.FormEvent<HTMLFormElement>) => void>(),
    clearEmailUpdate: vi.fn<() => void>(),
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
    deleteAccount: vi.fn<(event: React.FormEvent<HTMLFormElement>) => void>(),
    ...overrides,
  };
}

describe("SettingsSections", () => {
  it("submits the handle form and switches handle modes", () => {
    const saveHandle = vi.fn<(event: React.FormEvent<HTMLFormElement>) => void>(
      (event) => event.preventDefault(),
    );
    const setCustomHandle =
      vi.fn<React.Dispatch<React.SetStateAction<boolean>>>();
    render(<SettingsSections {...props({ saveHandle, setCustomHandle })} />);

    fireEvent.click(
      screen.getByRole("button", { name: "settings.changeHandleButton" }),
    );
    expect(saveHandle).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: "settings.customDomain" }),
    );
    expect(setCustomHandle).toHaveBeenCalledWith(true);
  });

  it("requests an account deletion code", () => {
    const requestDelete = vi.fn<Props["requestDelete"]>(() =>
      Promise.resolve(),
    );
    render(<SettingsSections {...props({ requestDelete })} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Request deletion code" }),
    );
    expect(requestDelete).toHaveBeenCalledOnce();
  });
});
