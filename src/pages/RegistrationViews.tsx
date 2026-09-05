import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import { Link } from "react-router-dom";
import {
  ChannelVerificationPrompt,
  type ChannelVerificationServer,
} from "../components/ChannelVerificationPrompt.tsx";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "../components/ui.tsx";
import type { Did, Handle } from "../lib/types/branded.ts";
import type { DidType, VerificationChannel } from "../lib/types/api.ts";

export type RegistrationMode = "passkey" | "password";
export type RegistrationStepView =
  | "info"
  | "key"
  | "document"
  | "creating"
  | "passkey"
  | "app-password"
  | "verify"
  | "updated-document";

export type RegistrationAccount = {
  did: Did;
  handle: Handle;
  setupToken?: string;
  appPassword?: string;
  appPasswordName?: string;
};

export interface RegistrationFormState {
  handle: string;
  domain: string;
  email: string;
  password: string;
  confirmPassword: string;
  inviteCode: string;
  didType: DidType;
  externalDid: string;
  channel: VerificationChannel;
  discord: string;
  telegram: string;
  signal: string;
  passkeyName: string;
}

type FormStateProps = {
  form: RegistrationFormState;
  setForm: Dispatch<SetStateAction<RegistrationFormState>>;
};

export function AccountDetailsView({
  mode,
  form,
  setForm,
  server,
  availableChannels,
  fullHandle,
  busy,
  onSubmit,
  onModeChange,
}: FormStateProps & {
  mode: RegistrationMode;
  server: {
    availableUserDomains: string[];
    selfHostedDidWebEnabled?: boolean;
    inviteCodeRequired?: boolean;
  };
  availableChannels: VerificationChannel[];
  fullHandle: string;
  busy: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onModeChange: (mode: RegistrationMode) => void;
}) {
  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={mode === "passkey" ? "primary" : "secondary"}
          onClick={() => onModeChange("passkey")}
        >
          Passkey
        </Button>
        <Button
          type="button"
          variant={mode === "password" ? "primary" : "secondary"}
          onClick={() => onModeChange("password")}
        >
          Password
        </Button>
      </div>
      <div className="grid grid-cols-[1fr_minmax(9rem,auto)] gap-2">
        <Field label="Handle">
          <Input
            value={form.handle}
            onChange={(event) =>
              setForm({ ...form, handle: event.target.value })
            }
            placeholder="alice"
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Domain">
          <Select
            value={form.domain}
            onChange={(event) =>
              setForm({ ...form, domain: event.target.value })
            }
          >
            {server.availableUserDomains.map((domain) => (
              <option key={domain}>{domain}</option>
            ))}
          </Select>
        </Field>
      </div>
      {fullHandle ? (
        <p className="-mt-2 font-mono text-xs text-ctp-green">@{fullHandle}</p>
      ) : null}
      {mode === "password" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password">
            <Input
              type="password"
              minLength={8}
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Confirm password">
            <Input
              type="password"
              minLength={8}
              value={form.confirmPassword}
              onChange={(event) =>
                setForm({ ...form, confirmPassword: event.target.value })
              }
              autoComplete="new-password"
              required
            />
          </Field>
        </div>
      ) : null}
      <Field label="Verification channel">
        <Select
          value={form.channel}
          onChange={(event) =>
            setForm({
              ...form,
              channel: event.target.value as VerificationChannel,
            })
          }
        >
          {availableChannels.map((channel) => (
            <option key={channel}>{channel}</option>
          ))}
        </Select>
      </Field>
      {form.channel === "email" ? (
        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
            autoComplete="email"
            required
          />
        </Field>
      ) : (
        <Field label={`${form.channel} username`}>
          <Input
            value={form[form.channel]}
            onChange={(event) =>
              setForm({ ...form, [form.channel]: event.target.value })
            }
            required
          />
        </Field>
      )}
      <Field label="DID type">
        <Select
          value={form.didType}
          onChange={(event) =>
            setForm({ ...form, didType: event.target.value as DidType })
          }
        >
          <option value="plc">did:plc</option>
          {server.selfHostedDidWebEnabled !== false ? (
            <option value="web">Hosted did:web</option>
          ) : null}
          <option value="web-external">Existing did:web</option>
        </Select>
      </Field>
      {form.didType === "web-external" ? (
        <Field label="Existing DID">
          <Input
            value={form.externalDid}
            onChange={(event) =>
              setForm({ ...form, externalDid: event.target.value })
            }
            placeholder="did:web:example.com"
            required
          />
        </Field>
      ) : null}
      {server.inviteCodeRequired ? (
        <Field label="Invite code">
          <Input
            value={form.inviteCode}
            onChange={(event) =>
              setForm({ ...form, inviteCode: event.target.value })
            }
            required
          />
        </Field>
      ) : null}
      <Button disabled={busy}>{busy ? "Creating" : "Create account"}</Button>
      <Link className="text-center text-sm" to="/app/migrate">
        Move an existing account
      </Link>
      <Link className="text-center text-sm" to="/app/login">
        Sign in instead
      </Link>
    </form>
  );
}

export function DidSetupView({
  step,
  documentText,
  busy,
  onChooseKey,
  onBack,
  onContinue,
}: {
  step: "key" | "document" | "updated-document";
  documentText: string;
  busy: boolean;
  onChooseKey: (mode: "reserved" | "byod") => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  if (step === "key") {
    return (
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-ctp-subtext0">
          Choose who creates the first signing key for your existing DID.
        </p>
        <Button disabled={busy} onClick={() => onChooseKey("reserved")}>
          Use a server-reserved key
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => onChooseKey("byod")}
        >
          Generate a key in this browser
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <Alert tone="warning">
        Publish this document at your did:web address before continuing.
      </Alert>
      <Field label="DID document">
        <Textarea
          className="min-h-80 bg-ctp-crust"
          value={documentText}
          readOnly
          spellCheck={false}
        />
      </Field>
      <Button
        variant="secondary"
        onClick={() => void navigator.clipboard.writeText(documentText)}
      >
        Copy document
      </Button>
      <Button disabled={busy} onClick={onContinue}>
        {busy ? "Checking" : "I published it"}
      </Button>
    </div>
  );
}

export function CredentialView({
  step,
  form,
  setForm,
  account,
  busy,
  onCreatePasskey,
  onCredentialSaved,
}: FormStateProps & {
  step: "passkey" | "app-password";
  account: RegistrationAccount | null;
  busy: boolean;
  onCreatePasskey: () => void;
  onCredentialSaved: () => void;
}) {
  if (step === "passkey") {
    return (
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-ctp-subtext0">
          Create the passkey you will use to sign in.
        </p>
        <Field label="Passkey name" hint="Optional">
          <Input
            value={form.passkeyName}
            onChange={(event) =>
              setForm({ ...form, passkeyName: event.target.value })
            }
            placeholder="This device"
          />
        </Field>
        <Button disabled={busy} onClick={onCreatePasskey}>
          {busy ? "Waiting for browser" : "Create passkey"}
        </Button>
      </div>
    );
  }

  if (!account) return null;
  return (
    <div className="grid gap-4">
      <Alert tone="warning">
        Save this recovery credential now. It will not be shown again.
      </Alert>
      <Card className="p-4">
        <p className="text-xs text-ctp-overlay1">{account.appPasswordName}</p>
        <code className="mt-2 block font-mono break-all text-ctp-green">
          {account.appPassword}
        </code>
      </Card>
      <Button
        variant="secondary"
        onClick={() =>
          void navigator.clipboard.writeText(account.appPassword ?? "")
        }
      >
        Copy credential
      </Button>
      <Button onClick={onCredentialSaved}>I saved it</Button>
    </div>
  );
}

export function VerificationView({
  form,
  setForm,
  account,
  server,
  usesBotVerification,
  restoredPasswordRequired,
  verificationCode,
  busy,
  onVerificationCodeChange,
  onSubmit,
}: FormStateProps & {
  account: RegistrationAccount | null;
  server: ChannelVerificationServer;
  usesBotVerification: boolean;
  restoredPasswordRequired: boolean;
  verificationCode: string;
  busy: boolean;
  onVerificationCodeChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const restoredPasswordField = restoredPasswordRequired ? (
    <Field
      label="Account password"
      hint="Required after restoring an interrupted registration."
    >
      <Input
        type="password"
        value={form.password}
        onChange={(event) => setForm({ ...form, password: event.target.value })}
        autoComplete="current-password"
        required
      />
    </Field>
  ) : null;

  if (usesBotVerification && account) {
    return (
      <div className="grid gap-4">
        <ChannelVerificationPrompt
          channel={form.channel}
          handle={account.handle}
          server={server}
        />
        {restoredPasswordField}
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <p className="text-sm leading-6 text-ctp-subtext0">
        Enter the code sent through {form.channel}.
      </p>
      <Field label="Verification code">
        <Input
          value={verificationCode}
          onChange={(event) => onVerificationCodeChange(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </Field>
      {restoredPasswordField}
      <Button disabled={busy || !verificationCode.trim()}>
        {busy ? "Verifying" : "Verify"}
      </Button>
    </form>
  );
}
