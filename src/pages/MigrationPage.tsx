import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import {
  ChannelVerificationPrompt,
  hasBotVerification,
  useBotVerificationPolling,
} from "../components/ChannelVerificationPrompt.tsx";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Loading,
  Select,
  Textarea,
} from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { setSession } from "../lib/auth.ts";
import { startOAuthLogin } from "../lib/oauth.ts";
import { unsafeAsAccessToken } from "../lib/types/branded.ts";
import {
  clearMigrationState,
  clearOfflineState,
  createInboundMigrationFlow,
  createOfflineInboundMigrationFlow,
  getOfflineResumeInfo,
  getResumeInfo,
  hasPendingOfflineMigration,
  hasPendingMigration,
  loadMigrationState,
  type InboundMigrationFlow,
  type OfflineInboundMigrationFlow,
} from "../lib/migration/index.ts";
import { createPasskeyCredential } from "../lib/flows/perform-passkey-registration.ts";
import type {
  InboundMigrationState,
  MigrationProgress,
  VerificationChannel,
} from "../lib/migration/types.ts";
import type { ServerDescription } from "../lib/types/api.ts";

type Direction = "select" | "inbound" | "offline";
type AccountFieldsState = Pick<
  InboundMigrationState,
  | "targetHandle"
  | "targetEmail"
  | "targetPassword"
  | "inviteCode"
  | "authMethod"
  | "verificationChannel"
  | "discordUsername"
  | "telegramUsername"
  | "signalUsername"
>;
type AccountField = keyof AccountFieldsState;
type PendingResume =
  | {
      direction: "inbound";
      sourceHandle: string;
      targetHandle: string;
      progressSummary: string;
    }
  | { direction: "offline"; userDid: string; targetHandle: string };

function MigrationFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <AuthLayout title={title} description={description}>
      <div className="grid gap-4">{children}</div>
    </AuthLayout>
  );
}

function Actions({
  back,
  next,
  disabled,
  busy,
  nextLabel = "Continue",
}: {
  back?: () => void;
  next: () => void;
  disabled?: boolean;
  busy?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="flex gap-2">
      {back ? (
        <Button type="button" variant="ghost" onClick={back}>
          Back
        </Button>
      ) : null}
      <Button
        type="button"
        className="flex-1"
        disabled={disabled || busy}
        onClick={next}
      >
        {busy ? "Working" : nextLabel}
      </Button>
    </div>
  );
}

function ProgressView({ progress }: { progress: MigrationProgress }) {
  const entries = [
    ["Repository exported", progress.repoExported],
    ["Repository imported", progress.repoImported],
    [
      `Blobs migrated (${progress.blobsMigrated}/${progress.blobsTotal})`,
      progress.blobsTotal > 0 && progress.blobsMigrated >= progress.blobsTotal,
    ],
    ["Preferences migrated", progress.prefsMigrated],
    ["Identity updated", progress.plcSigned],
    ["Account activated", progress.activated],
  ] as const;
  return (
    <MigrationFrame
      title="Moving your account"
      description={
        progress.currentOperation ||
        "Migration is in progress. Keep this page open."
      }
    >
      <div className="grid gap-2">
        {entries.map(([label, done]) => (
          <div
            key={label}
            className="flex items-center justify-between rounded border border-ctp-surface-0 px-3 py-2 text-sm"
          >
            <span>{label}</span>
            <span className={done ? "text-ctp-green" : "text-ctp-overlay-0"}>
              {done ? "done" : "pending"}
            </span>
          </div>
        ))}
      </div>
      <Loading label="Working" />
    </MigrationFrame>
  );
}

function verificationIdentifier(state: {
  verificationChannel: VerificationChannel;
  targetEmail: string;
  discordUsername: string;
  telegramUsername: string;
  signalUsername: string;
}): string {
  switch (state.verificationChannel) {
    case "discord":
      return state.discordUsername;
    case "telegram":
      return state.telegramUsername;
    case "signal":
      return state.signalUsername;
    default:
      return state.targetEmail;
  }
}

function AccountFields({
  state,
  serverInfo,
  update,
}: {
  state: AccountFieldsState;
  serverInfo: ServerDescription | null;
  update: (
    field: AccountField,
    value: AccountFieldsState[AccountField],
  ) => void;
}) {
  const availableChannels = [
    "email",
    ...(serverInfo?.availableCommsChannels ?? []).filter(
      (channel) => channel !== "email",
    ),
  ];
  return (
    <>
      <Field
        label="Handle"
        hint="Enter the complete handle you want on this PDS."
      >
        <Input
          value={state.targetHandle}
          onChange={(event) => update("targetHandle", event.target.value)}
          placeholder={`alice.${globalThis.location.hostname}`}
          required
        />
      </Field>
      <Field label="Sign-in method">
        <Select
          value={state.authMethod}
          onChange={(event) => update("authMethod", event.target.value)}
        >
          <option value="password">Password</option>
          <option value="passkey">Passkey</option>
        </Select>
      </Field>
      {state.authMethod === "password" ? (
        <Field label="New password">
          <Input
            type="password"
            minLength={8}
            value={state.targetPassword}
            onChange={(event) => update("targetPassword", event.target.value)}
            required
          />
        </Field>
      ) : null}
      <Field label="Verification channel">
        <Select
          value={state.verificationChannel}
          onChange={(event) =>
            update("verificationChannel", event.target.value)
          }
        >
          {availableChannels.map((channel) => (
            <option key={channel} value={channel}>
              {channel[0].toUpperCase() + channel.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      {state.verificationChannel === "email" ? (
        <Field label="Email">
          <Input
            type="email"
            value={state.targetEmail}
            onChange={(event) => update("targetEmail", event.target.value)}
            required
          />
        </Field>
      ) : null}
      {state.verificationChannel === "discord" ? (
        <Field label="Discord username">
          <Input
            value={state.discordUsername}
            onChange={(event) => update("discordUsername", event.target.value)}
            required
          />
        </Field>
      ) : null}
      {state.verificationChannel === "telegram" ? (
        <Field label="Telegram username">
          <Input
            value={state.telegramUsername}
            onChange={(event) => update("telegramUsername", event.target.value)}
            required
          />
        </Field>
      ) : null}
      {state.verificationChannel === "signal" ? (
        <Field label="Signal username">
          <Input
            value={state.signalUsername}
            onChange={(event) => update("signalUsername", event.target.value)}
            required
          />
        </Field>
      ) : null}
      <Field
        label="Invite code"
        hint="Leave blank if this server does not require one."
      >
        <Input
          value={state.inviteCode}
          onChange={(event) => update("inviteCode", event.target.value)}
        />
      </Field>
    </>
  );
}

function VerificationStep({
  channel,
  identifier,
  handle,
  server,
  token,
  error,
  busy,
  onTokenChange,
  onSubmit,
  onResend,
  onPoll,
  children,
}: {
  channel: VerificationChannel;
  identifier: string;
  handle: string;
  server: ServerDescription | null;
  token: string;
  error: string | null;
  busy: boolean;
  onTokenChange: (token: string) => void;
  onSubmit: () => void;
  onResend: () => void;
  onPoll: () => Promise<boolean>;
  children?: ReactNode;
}) {
  const usesBotVerification = hasBotVerification(channel);
  useBotVerificationPolling(usesBotVerification, onPoll);

  if (usesBotVerification) {
    return (
      <MigrationFrame
        title="Verify the new account"
        description={`Complete verification in ${channel}, then leave this page open.`}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <ChannelVerificationPrompt
          channel={channel}
          handle={handle}
          server={server ?? {}}
        />
      </MigrationFrame>
    );
  }

  return (
    <MigrationFrame
      title="Verify the new account"
      description={`Enter the code sent to ${identifier} through ${channel}.`}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label="Verification code">
        <Input
          value={token}
          onChange={(event) => onTokenChange(event.target.value)}
          autoComplete="one-time-code"
        />
      </Field>
      {children}
      <Actions busy={busy} disabled={!token.trim()} next={onSubmit} />
      <Button variant="secondary" disabled={busy} onClick={onResend}>
        Resend code
      </Button>
    </MigrationFrame>
  );
}

async function finishMigration(
  flow: InboundMigrationFlow | OfflineInboundMigrationFlow,
  navigate: ReturnType<typeof useNavigate>,
) {
  const session = flow.getLocalSession();
  if (!session) {
    navigate("/app/login");
    return;
  }
  try {
    await api.establishOAuthSession(unsafeAsAccessToken(session.accessJwt));
    await startOAuthLogin(session.handle);
  } catch {
    setSession({ ...session, refreshJwt: "" });
    navigate("/app/settings");
  }
}

function InboundWizard({
  flow,
  onBack,
}: {
  flow: InboundMigrationFlow;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [, redraw] = useReducer((value) => value + 1, 0);
  const [handle, setHandle] = useState(flow.state.sourceHandle);
  const [busy, setBusy] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [localPassword, setLocalPassword] = useState("");
  const [passkeyName, setPasskeyName] = useState("");
  const [serverInfo, setServerInfo] = useState<ServerDescription | null>(null);
  const state = flow.state;

  useEffect(() => {
    const timer = setInterval(redraw, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    void flow
      .loadLocalServerInfo()
      .then((info) => {
        if (active) setServerInfo(info);
      })
      .catch((caught) => {
        if (active)
          flow.setError(
            caught instanceof Error
              ? caught.message
              : "Could not load server settings.",
          );
      });
    return () => {
      active = false;
    };
  }, [flow]);
  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    flow.setError(null);
    try {
      await action();
    } catch (caught) {
      flow.setError(
        caught instanceof Error ? caught.message : "Migration failed.",
      );
    } finally {
      setBusy(false);
      redraw();
    }
  }

  if (["migrating", "finalizing"].includes(state.step))
    return <ProgressView progress={state.progress} />;
  if (state.step === "welcome")
    return (
      <MigrationFrame
        title="Move an account here"
        description="This transfers your repository and identity from another PDS while keeping your DID, followers, and account data."
      >
        <Alert tone="warning">
          Migration changes the PDS endpoint in your identity. Keep access to
          the old account until this finishes.
        </Alert>
        <label className="flex gap-3 text-sm text-ctp-subtext-0">
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />{" "}
          I understand this operation changes my account’s hosting provider.
        </label>
        <Actions
          back={onBack}
          disabled={!understood}
          next={() => {
            flow.setStep("source-handle");
            redraw();
          }}
        />
      </MigrationFrame>
    );
  if (state.step === "source-handle")
    return (
      <MigrationFrame
        title="Connect the source account"
        description="You will authorize read and migration access on the PDS that currently hosts this account."
      >
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <Field label="Current handle">
          <Input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="alice.example.com"
          />
        </Field>
        <Actions
          back={() => {
            flow.setStep("welcome");
            redraw();
          }}
          disabled={!handle.trim()}
          busy={busy}
          nextLabel="Authorize source PDS"
          next={() => void run(() => flow.initiateOAuthLogin(handle.trim()))}
        />
      </MigrationFrame>
    );
  if (state.step === "choose-handle")
    return (
      <MigrationFrame
        title="Set up the account here"
        description={`Connected as @${state.sourceHandle}. Choose the credentials this PDS will use.`}
      >
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <AccountFields
          state={state}
          serverInfo={serverInfo}
          update={(field, value) => {
            flow.updateField(field, value);
            redraw();
          }}
        />
        <Actions
          back={() => {
            flow.setStep("source-handle");
            redraw();
          }}
          disabled={
            !state.targetHandle ||
            !verificationIdentifier(state).trim() ||
            (state.authMethod === "password" && state.targetPassword.length < 8)
          }
          next={() =>
            void run(async () => {
              if (!(await flow.checkHandleAvailability(state.targetHandle)))
                throw new Error("That handle is not available.");
              flow.setStep("review");
            })
          }
        />
      </MigrationFrame>
    );
  if (state.step === "review")
    return (
      <MigrationFrame
        title="Review the move"
        description="Nothing is changed until you start the migration."
      >
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <Card className="grid gap-3 p-4 text-sm">
          <p>
            <span className="text-ctp-overlay-1">From</span>
            <br />@{state.sourceHandle}
          </p>
          <p>
            <span className="text-ctp-overlay-1">To</span>
            <br />@{state.targetHandle}
          </p>
          <p>
            <span className="text-ctp-overlay-1">DID retained</span>
            <br />
            <span className="font-mono text-xs">{state.sourceDid}</span>
          </p>
        </Card>
        <Actions
          back={() => {
            flow.setStep("choose-handle");
            redraw();
          }}
          busy={busy}
          nextLabel="Start migration"
          next={() => void run(() => flow.startMigration())}
        />
      </MigrationFrame>
    );
  if (state.step === "email-verify")
    return (
      <VerificationStep
        channel={state.verificationChannel}
        identifier={verificationIdentifier(state)}
        handle={state.targetHandle}
        server={serverInfo}
        token={state.emailVerifyToken}
        error={state.error}
        busy={busy}
        onTokenChange={(token) => {
          flow.updateField("emailVerifyToken", token);
          redraw();
        }}
        onSubmit={() =>
          void run(() =>
            flow.submitEmailVerifyToken(
              state.emailVerifyToken,
              localPassword || undefined,
            ),
          )
        }
        onResend={() => void run(() => flow.resendEmailVerification())}
        onPoll={flow.checkEmailVerifiedAndProceed}
      >
        {state.needsReauth ? (
          <Field label="New account password">
            <Input
              type="password"
              value={localPassword}
              onChange={(event) => setLocalPassword(event.target.value)}
            />
          </Field>
        ) : null}
      </VerificationStep>
    );
  if (state.step === "plc-token")
    return (
      <MigrationFrame
        title="Confirm the identity update"
        description="Enter the PLC operation code sent by the source PDS."
      >
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <Field label="PLC operation code">
          <Input
            value={state.plcToken}
            onChange={(event) => {
              flow.updateField("plcToken", event.target.value);
              redraw();
            }}
          />
        </Field>
        <Actions
          busy={busy}
          disabled={!state.plcToken.trim()}
          next={() => void run(() => flow.submitPlcToken(state.plcToken))}
        />
        <Button
          variant="secondary"
          onClick={() => void run(() => flow.resendPlcToken())}
        >
          Resend code
        </Button>
      </MigrationFrame>
    );
  if (state.step === "did-web-update")
    return (
      <MigrationFrame
        title="Update your did:web document"
        description="Publish the recommended verification method and PDS endpoint shown in your DID document before continuing."
      >
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <code className="overflow-auto rounded bg-ctp-crust p-3 text-xs">
          {state.targetVerificationMethod ??
            "The recommended credentials are ready."}
        </code>
        <Actions
          busy={busy}
          nextLabel="I updated the document"
          next={() => void run(() => flow.completeDidWebMigration())}
        />
      </MigrationFrame>
    );
  if (state.step === "passkey-setup")
    return (
      <MigrationFrame title="Create a passkey">
        <Field label="Passkey name">
          <Input
            value={passkeyName}
            onChange={(event) => setPasskeyName(event.target.value)}
            placeholder="This device"
          />
        </Field>
        <Actions
          busy={busy}
          next={() =>
            void run(async () => {
              const credential = await createPasskeyCredential(() =>
                flow.startPasskeyRegistration(),
              );
              await flow.completePasskeyRegistration(
                credential,
                passkeyName || undefined,
              );
            })
          }
        />
      </MigrationFrame>
    );
  if (state.step === "app-password")
    return (
      <MigrationFrame
        title="Save the migration app password"
        description="Store this once. It will not be shown again."
      >
        <Alert tone="warning">
          <span className="font-mono break-all">
            {state.generatedAppPassword}
          </span>
        </Alert>
        <Actions
          busy={busy}
          next={() => void run(() => flow.proceedFromAppPassword())}
        />
      </MigrationFrame>
    );
  if (state.step === "success")
    return (
      <MigrationFrame
        title="Migration complete"
        description={`@${state.targetHandle} is now hosted on ${globalThis.location.hostname}.`}
      >
        <Alert tone="success">
          Your repository, blobs, preferences, and identity were moved.
        </Alert>
        <Button onClick={() => void finishMigration(flow, navigate)}>
          Open account manager
        </Button>
      </MigrationFrame>
    );
  return (
    <MigrationFrame title="Migration stopped">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Actions
        back={onBack}
        nextLabel="Start over"
        next={() => {
          flow.reset();
          redraw();
        }}
      />
    </MigrationFrame>
  );
}

function OfflineWizard({
  flow,
  onBack,
}: {
  flow: OfflineInboundMigrationFlow;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [, redraw] = useReducer((value) => value + 1, 0);
  const [busy, setBusy] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [serverInfo, setServerInfo] = useState<ServerDescription | null>(null);
  const state = flow.state;
  useEffect(() => {
    const timer = setInterval(redraw, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    void flow
      .loadLocalServerInfo()
      .then((info) => {
        if (active) setServerInfo(info);
      })
      .catch((caught) => {
        if (active)
          flow.setError(
            caught instanceof Error
              ? caught.message
              : "Could not load server settings.",
          );
      });
    return () => {
      active = false;
    };
  }, [flow]);
  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    flow.setError(null);
    try {
      await action();
    } catch (caught) {
      flow.setError(
        caught instanceof Error ? caught.message : "Restore failed.",
      );
    } finally {
      setBusy(false);
      redraw();
    }
  }
  if (
    [
      "creating",
      "importing",
      "migrating-blobs",
      "plc-signing",
      "finalizing",
    ].includes(state.step)
  )
    return <ProgressView progress={state.progress} />;
  if (state.step === "welcome")
    return (
      <MigrationFrame
        title="Restore from an offline backup"
        description="Use a repository CAR export and a PLC rotation key when the old PDS cannot be reached."
      >
        <Alert tone="warning">
          The rotation key controls your identity. Do not paste it anywhere
          except a PDS you trust.
        </Alert>
        <label className="flex gap-3 text-sm">
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />{" "}
          I have a repository export and the correct rotation key.
        </label>
        <Actions
          back={onBack}
          disabled={!understood}
          next={() => {
            flow.setStep("provide-did");
            redraw();
          }}
        />
      </MigrationFrame>
    );
  if (state.step === "provide-did")
    return (
      <MigrationFrame title="Identify the account">
        <Field label="Account DID">
          <Input
            value={state.userDid}
            onChange={(event) => {
              flow.setUserDid(event.target.value);
              redraw();
            }}
            placeholder="did:plc:…"
          />
        </Field>
        <Actions
          back={() => {
            flow.setStep("welcome");
            redraw();
          }}
          disabled={!state.userDid.startsWith("did:")}
          next={() => {
            flow.setStep("upload-car");
            redraw();
          }}
        />
      </MigrationFrame>
    );
  if (state.step === "upload-car")
    return (
      <MigrationFrame title="Upload the repository export">
        <Field label="CAR file">
          <Input
            type="file"
            accept=".car,application/octet-stream"
            onChange={(event) =>
              void run(async () => {
                const file = event.target.files?.[0];
                if (!file) return;
                flow.setCarFile(
                  new Uint8Array(await file.arrayBuffer()),
                  file.name,
                );
              })
            }
          />
        </Field>
        {state.carFileName ? (
          <Alert tone="success">Loaded {state.carFileName}</Alert>
        ) : null}
        <Actions
          back={() => {
            flow.setStep("provide-did");
            redraw();
          }}
          disabled={!state.carFile}
          next={() => {
            flow.setStep("provide-rotation-key");
            redraw();
          }}
        />
      </MigrationFrame>
    );
  if (state.step === "provide-rotation-key")
    return (
      <MigrationFrame title="Provide the PLC rotation key">
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <Field label="Rotation key">
          <Textarea
            value={state.rotationKey}
            onChange={(event) => {
              flow.setRotationKey(event.target.value);
              redraw();
            }}
            autoComplete="off"
          />
        </Field>
        <Actions
          back={() => {
            flow.setStep("upload-car");
            redraw();
          }}
          busy={busy}
          disabled={!state.rotationKey.trim()}
          next={() =>
            void run(async () => {
              if (!(await flow.validateRotationKey()))
                throw new Error(
                  "This key does not match the DID’s active rotation keys.",
                );
              flow.setStep("choose-handle");
            })
          }
        />
      </MigrationFrame>
    );
  if (state.step === "choose-handle")
    return (
      <MigrationFrame title="Set up the restored account">
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <AccountFields
          state={state}
          serverInfo={serverInfo}
          update={(field, value) => {
            flow.updateField(field, value);
            redraw();
          }}
        />
        <Actions
          back={() => {
            flow.setStep("provide-rotation-key");
            redraw();
          }}
          disabled={
            !state.targetHandle ||
            !verificationIdentifier(state).trim() ||
            (state.authMethod === "password" && state.targetPassword.length < 8)
          }
          next={() =>
            void run(async () => {
              if (!(await flow.checkHandleAvailability(state.targetHandle)))
                throw new Error("That handle is not available.");
              flow.setStep("review");
            })
          }
        />
      </MigrationFrame>
    );
  if (state.step === "review")
    return (
      <MigrationFrame title="Review the restore">
        <Card className="grid gap-3 p-4 text-sm">
          <p>
            DID
            <br />
            <span className="font-mono text-xs">{state.userDid}</span>
          </p>
          <p>
            Repository
            <br />
            {state.carFileName}
          </p>
          <p>
            New handle
            <br />@{state.targetHandle}
          </p>
        </Card>
        <Actions
          back={() => {
            flow.setStep("choose-handle");
            redraw();
          }}
          busy={busy}
          nextLabel="Start restore"
          next={() => void run(() => flow.runMigration())}
        />
      </MigrationFrame>
    );
  if (state.step === "email-verify")
    return (
      <VerificationStep
        channel={state.verificationChannel}
        identifier={verificationIdentifier(state)}
        handle={state.targetHandle}
        server={serverInfo}
        token={state.emailVerifyToken}
        error={state.error}
        busy={busy}
        onTokenChange={(token) => {
          flow.updateField("emailVerifyToken", token);
          redraw();
        }}
        onSubmit={() =>
          void run(() => flow.submitEmailVerifyToken(state.emailVerifyToken))
        }
        onResend={() => void run(() => flow.resendEmailVerification())}
        onPoll={flow.checkEmailVerifiedAndProceed}
      />
    );
  if (state.step === "passkey-setup")
    return (
      <MigrationFrame title="Create a passkey">
        <Field label="Passkey name">
          <Input
            value={passkeyName}
            onChange={(event) => setPasskeyName(event.target.value)}
          />
        </Field>
        <Actions
          busy={busy}
          next={() =>
            void run(() => flow.registerPasskey(passkeyName || undefined))
          }
        />
      </MigrationFrame>
    );
  if (state.step === "app-password")
    return (
      <MigrationFrame title="Save the migration app password">
        <Alert tone="warning">
          <span className="font-mono break-all">
            {state.generatedAppPassword}
          </span>
        </Alert>
        <Actions
          busy={busy}
          next={() => void run(() => flow.proceedFromAppPassword())}
        />
      </MigrationFrame>
    );
  if (state.step === "success")
    return (
      <MigrationFrame title="Restore complete">
        <Alert tone="success">
          The account is active on {globalThis.location.hostname}.
        </Alert>
        <Button onClick={() => void finishMigration(flow, navigate)}>
          Open account manager
        </Button>
      </MigrationFrame>
    );
  return (
    <MigrationFrame title="Restore stopped">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Actions
        back={onBack}
        nextLabel="Start over"
        next={() => {
          flow.reset();
          redraw();
        }}
      />
    </MigrationFrame>
  );
}

export function MigrationPage() {
  const [direction, setDirection] = useState<Direction>("select");
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [pendingResume, setPendingResume] = useState<PendingResume | null>(
    null,
  );
  const [resumeBusy, setResumeBusy] = useState(false);
  const inboundRef = useRef<InboundMigrationFlow | null>(null);
  const offlineRef = useRef<OfflineInboundMigrationFlow | null>(null);
  const callbackHandled = useRef(false);
  const pendingMigrationChecked = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error_description") ?? params.get("error");
    if (code || error) {
      if (callbackHandled.current) return;
      callbackHandled.current = true;
      globalThis.history.replaceState({}, "", "/app/migrate");
      if (error) {
        setCallbackError(error);
        return;
      }
      if (!code || !state) return;
      const flow = createInboundMigrationFlow();
      inboundRef.current = flow;
      setDirection("inbound");
      void (async () => {
        const stored = loadMigrationState();
        if (stored?.direction === "inbound") await flow.resumeFromState(stored);
        await flow.handleOAuthCallback(code, state);
      })().catch((caught) =>
        setCallbackError(
          caught instanceof Error
            ? caught.message
            : "OAuth authentication failed.",
        ),
      );
      return;
    }

    if (pendingMigrationChecked.current) return;
    pendingMigrationChecked.current = true;
    if (hasPendingMigration()) {
      const info = getResumeInfo();
      if (info?.step === "success") clearMigrationState();
      else if (info)
        setPendingResume({
          direction: "inbound",
          sourceHandle: info.sourceHandle,
          targetHandle: info.targetHandle,
          progressSummary: info.progressSummary,
        });
      return;
    }
    if (hasPendingOfflineMigration()) {
      const info = getOfflineResumeInfo();
      if (info?.step === "success") clearOfflineState();
      else if (info)
        setPendingResume({
          direction: "offline",
          userDid: info.userDid,
          targetHandle: info.targetHandle,
        });
    }
  }, []);

  async function resumeMigration() {
    if (!pendingResume) return;
    setResumeBusy(true);
    try {
      if (pendingResume.direction === "inbound") {
        const stored = loadMigrationState();
        if (!stored) throw new Error("The saved migration has expired.");
        const flow = createInboundMigrationFlow();
        await flow.resumeFromState(stored);
        inboundRef.current = flow;
        setDirection("inbound");
      } else {
        const flow = createOfflineInboundMigrationFlow();
        if (!flow.tryResume())
          throw new Error("The saved restore has expired.");
        offlineRef.current = flow;
        setDirection("offline");
      }
      setPendingResume(null);
    } catch (caught) {
      setCallbackError(
        caught instanceof Error
          ? caught.message
          : "Could not resume migration.",
      );
    } finally {
      setResumeBusy(false);
    }
  }

  function startOver() {
    if (pendingResume?.direction === "offline") clearOfflineState();
    else clearMigrationState();
    inboundRef.current = null;
    offlineRef.current = null;
    setPendingResume(null);
    setCallbackError(null);
    setDirection("select");
  }

  function leaveWizard(
    flow: InboundMigrationFlow | OfflineInboundMigrationFlow,
  ) {
    flow.reset();
    inboundRef.current = null;
    offlineRef.current = null;
    setDirection("select");
  }

  if (callbackError)
    return (
      <MigrationFrame title="Could not continue migration">
        <Alert tone="error">{callbackError}</Alert>
        <Button onClick={startOver}>Start over</Button>
      </MigrationFrame>
    );
  if (pendingResume)
    return (
      <MigrationFrame
        title="Resume migration"
        description="A migration started in this browser has not finished."
      >
        <Card className="grid gap-3 p-4 text-sm">
          {pendingResume.direction === "inbound" ? (
            <>
              <p>
                <span className="text-ctp-overlay-1">From</span>
                <br />@{pendingResume.sourceHandle}
              </p>
              {pendingResume.targetHandle ? (
                <p>
                  <span className="text-ctp-overlay-1">To</span>
                  <br />@{pendingResume.targetHandle}
                </p>
              ) : null}
              <p>
                <span className="text-ctp-overlay-1">Progress</span>
                <br />
                {pendingResume.progressSummary}
              </p>
            </>
          ) : (
            <>
              <p>
                <span className="text-ctp-overlay-1">DID</span>
                <br />
                <span className="font-mono text-xs">
                  {pendingResume.userDid}
                </span>
              </p>
              {pendingResume.targetHandle ? (
                <p>
                  <span className="text-ctp-overlay-1">Handle</span>
                  <br />@{pendingResume.targetHandle}
                </p>
              ) : null}
            </>
          )}
        </Card>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={resumeBusy}
            onClick={() => void resumeMigration()}
          >
            {resumeBusy ? "Resuming" : "Resume"}
          </Button>
          <Button variant="ghost" disabled={resumeBusy} onClick={startOver}>
            Start over
          </Button>
        </div>
      </MigrationFrame>
    );
  if (direction === "inbound") {
    inboundRef.current ??= createInboundMigrationFlow();
    const flow = inboundRef.current;
    return <InboundWizard flow={flow} onBack={() => leaveWizard(flow)} />;
  }
  if (direction === "offline") {
    offlineRef.current ??= createOfflineInboundMigrationFlow();
    const flow = offlineRef.current;
    return <OfflineWizard flow={flow} onBack={() => leaveWizard(flow)} />;
  }
  return (
    <MigrationFrame
      title="Move an account"
      description={`Bring an existing AT Protocol identity to ${globalThis.location.hostname}.`}
    >
      <button
        type="button"
        className="rounded border border-ctp-surface-1 bg-ctp-mantle p-5 text-left hover:border-ctp-lavender"
        onClick={() => {
          inboundRef.current = createInboundMigrationFlow();
          setDirection("inbound");
        }}
      >
        <strong className="font-mono text-ctp-text">
          Move from another PDS
        </strong>
        <span className="mt-2 block text-sm text-ctp-subtext-0">
          Connect the current host over OAuth and transfer the repository,
          blobs, and identity.
        </span>
      </button>
      <button
        type="button"
        className="rounded border border-ctp-surface-1 bg-ctp-mantle p-5 text-left hover:border-ctp-lavender"
        onClick={() => {
          offlineRef.current = createOfflineInboundMigrationFlow();
          setDirection("offline");
        }}
      >
        <strong className="font-mono text-ctp-text">
          Restore an offline backup
        </strong>
        <span className="mt-2 block text-sm text-ctp-subtext-0">
          Recover from a CAR export and PLC rotation key when the old host is
          unavailable.
        </span>
      </button>
      <Link className="text-center text-sm" to="/app/register">
        Back to registration
      </Link>
    </MigrationFrame>
  );
}
