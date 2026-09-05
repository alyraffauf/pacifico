import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  AccountDetailsView,
  CredentialView,
  DidSetupView,
  type RegistrationFormState,
} from "./RegistrationViews.tsx";
import { unsafeAsDid, unsafeAsHandle } from "../lib/types/branded.ts";

const initialForm: RegistrationFormState = {
  handle: "alice",
  domain: "example.com",
  email: "alice@example.com",
  password: "password1",
  confirmPassword: "password1",
  inviteCode: "",
  didType: "plc",
  externalDid: "",
  channel: "email",
  discord: "",
  telegram: "",
  signal: "",
  passkeyName: "",
};

describe("registration views", () => {
  it("moves from account details to the next registration step", () => {
    function Harness() {
      const [form, setForm] = useState(initialForm);
      const [step, setStep] = useState<"details" | "key">("details");
      return step === "details" ? (
        <MemoryRouter>
          <AccountDetailsView
            mode="passkey"
            form={form}
            setForm={setForm}
            server={{ availableUserDomains: ["example.com"] }}
            availableChannels={["email"]}
            fullHandle="alice.example.com"
            busy={false}
            onModeChange={vi.fn<(mode: "passkey" | "password") => void>()}
            onSubmit={(event) => {
              event.preventDefault();
              setStep("key");
            }}
          />
        </MemoryRouter>
      ) : (
        <DidSetupView
          step="key"
          documentText=""
          busy={false}
          onChooseKey={vi.fn<(mode: "reserved" | "byod") => void>()}
          onBack={() => setStep("details")}
          onContinue={vi.fn<() => void>()}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText(/Choose who creates/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeVisible();
  });

  it("continues after the generated credential is saved", () => {
    const onCredentialSaved = vi.fn<() => void>();
    render(
      <CredentialView
        step="app-password"
        form={initialForm}
        setForm={vi.fn<
          React.Dispatch<React.SetStateAction<RegistrationFormState>>
        >()}
        account={{
          did: unsafeAsDid("did:plc:alice"),
          handle: unsafeAsHandle("alice.example.com"),
          appPassword: "abcd-efgh-ijkl-mnop",
          appPasswordName: "Recovery credential",
        }}
        busy={false}
        onCreatePasskey={vi.fn<() => void>()}
        onCredentialSaved={onCredentialSaved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "I saved it" }));
    expect(onCredentialSaved).toHaveBeenCalledOnce();
  });
});
