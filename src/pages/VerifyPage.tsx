import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import {
  ChannelVerificationPrompt,
  hasBotVerification,
  useBotVerificationPolling,
  type ChannelVerificationServer,
} from "../components/ChannelVerificationPrompt.tsx";
import { Alert, Button, Field, Input, Loading } from "../components/ui.tsx";
import { useAuthState } from "../hooks/useAuthState.ts";
import { confirmSignup, resendVerification } from "../lib/auth.ts";
import { api, ApiError } from "../lib/api.ts";
import type { VerificationChannel } from "../lib/types/api.ts";
import { unsafeAsDid, type Did } from "../lib/types/branded.ts";

const storageKey = "tranquil_pds_pending_verification";

interface PendingVerification {
  did: Did;
  handle: string;
  channel: VerificationChannel;
}

type VerificationMode =
  "signup" | "token" | "email-update" | "email-authorize-success";

function isVerificationChannel(value: string): value is VerificationChannel {
  return (
    value === "email" ||
    value === "discord" ||
    value === "telegram" ||
    value === "signal"
  );
}

function parsePendingVerification(
  value: string | null,
): PendingVerification | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.did !== "string" ||
      typeof parsed.handle !== "string" ||
      typeof parsed.channel !== "string" ||
      !isVerificationChannel(parsed.channel)
    )
      return null;
    return {
      did: unsafeAsDid(parsed.did),
      handle: parsed.handle,
      channel: parsed.channel,
    };
  } catch {
    return null;
  }
}

function getVerificationMode(params: URLSearchParams): VerificationMode {
  if (params.get("type") === "email-authorize-success")
    return "email-authorize-success";
  if (params.get("type") === "email-update") return "email-update";
  if (params.has("token")) return "token";
  return "signup";
}

export function VerifyPage() {
  const auth = useAuthState();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mode = getVerificationMode(params);
  const pending = useMemo(() => {
    const stored = parsePendingVerification(localStorage.getItem(storageKey));
    if (stored) return stored;
    const did = params.get("did");
    const handle = params.get("handle");
    const channel = params.get("channel");
    if (!did || !handle || !channel || !isVerificationChannel(channel))
      return null;
    const fromQuery = { did: unsafeAsDid(did), handle, channel };
    localStorage.setItem(storageKey, JSON.stringify(fromQuery));
    return fromQuery;
  }, [params]);
  const [server, setServer] = useState<ChannelVerificationServer | null>(null);
  const [identifier, setIdentifier] = useState(params.get("identifier") ?? "");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState(params.get("token") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const autoSubmitted = useRef(false);

  const session = auth.kind === "authenticated" ? auth.session : null;
  const usesBotVerification = Boolean(
    pending && hasBotVerification(pending.channel),
  );

  useEffect(() => {
    if (!pending || !hasBotVerification(pending.channel)) return;
    void api
      .describeServer()
      .then(setServer)
      .catch(() => setServer({}));
  }, [pending]);

  useEffect(() => {
    if (
      mode !== "token" ||
      !code.trim() ||
      !identifier.trim() ||
      autoSubmitted.current
    )
      return;
    autoSubmitted.current = true;
    void verifyToken();
  }, [code, identifier, mode]);

  useBotVerificationPolling(
    mode === "signup" && Boolean(pending) && usesBotVerification,
    async () => {
      if (!pending) return false;
      return (await api.checkChannelVerified(pending.did, pending.channel))
        .verified;
    },
    () => {
      localStorage.removeItem(storageKey);
      const requestUri = params.get("request_uri");
      navigate(
        requestUri
          ? `/app/oauth/consent?request_uri=${encodeURIComponent(requestUri)}`
          : "/app/login",
        { replace: true },
      );
    },
  );

  async function verifyToken() {
    if (!code.trim() || !identifier.trim()) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.verifyToken(
        code.trim(),
        identifier.trim(),
        session?.accessJwt,
      );
      setMessage(`Verification complete for ${result.channel}.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : "Verification failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "token") {
      await verifyToken();
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        if (!pending)
          throw new Error("No pending account verification was found.");
        const result = await confirmSignup(pending.did, code.trim());
        if (!result.ok) throw result.error;
        localStorage.removeItem(storageKey);
        const requestUri = params.get("request_uri");
        navigate(
          requestUri
            ? `/app/oauth/consent?request_uri=${encodeURIComponent(requestUri)}`
            : "/app/settings",
        );
        return;
      }
      if (mode === "email-update") {
        if (!session)
          throw new Error("Sign in before authorizing an email change.");
        await api.updateEmail(session.accessJwt, newEmail.trim(), code.trim());
        setMessage("Your email address has been updated.");
        return;
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : "Verification failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "signup" && pending) {
        const result = await resendVerification(pending.did);
        if (!result.ok) throw result.error;
      } else {
        await api.resendMigrationVerification("email", identifier.trim());
      }
      setMessage("A new verification code was sent.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not resend the code.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "email-authorize-success") {
    return (
      <AuthLayout title="Email change authorized">
        <Alert tone="success">
          Your current email address was authorized. Return to settings to
          finish the change.
        </Alert>
        <Link className="mt-4 block text-center text-sm" to="/app/settings">
          Back to settings
        </Link>
      </AuthLayout>
    );
  }

  const title =
    mode === "signup"
      ? "Verify your account"
      : mode === "email-update"
        ? "Confirm your new email"
        : "Verify a token";
  return (
    <AuthLayout
      title={title}
      description={
        mode === "signup" && pending
          ? `Complete ${pending.channel} verification for @${pending.handle}.`
          : "Enter the identifier and verification code you received."
      }
    >
      {mode === "signup" &&
      pending &&
      (pending.channel === "discord" || pending.channel === "telegram") &&
      !server ? (
        <Loading label="Loading verification details" />
      ) : null}
      {usesBotVerification && pending && server ? (
        <ChannelVerificationPrompt
          channel={pending.channel}
          handle={pending.handle}
          server={server}
        />
      ) : null}
      {!usesBotVerification ? (
        <form className="grid gap-4" onSubmit={submit}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {message ? <Alert tone="success">{message}</Alert> : null}
          {mode === "token" ? (
            <Field label="Email or account identifier">
              <Input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                required
              />
            </Field>
          ) : null}
          {mode === "email-update" ? (
            <Field label="New email address">
              <Input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                required
              />
            </Field>
          ) : null}
          <Field label="Verification code">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              required
            />
          </Field>
          <Button disabled={submitting}>
            {submitting ? "Working" : "Verify"}
          </Button>
          {mode !== "email-update" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={
                submitting ||
                (mode === "token" && !identifier.trim()) ||
                (mode === "signup" && !pending)
              }
              onClick={() => void resend()}
            >
              Resend code
            </Button>
          ) : null}
          <Link
            className="text-center text-sm"
            to={session ? "/app/settings" : "/app/login"}
          >
            Back
          </Link>
        </form>
      ) : null}
      {usesBotVerification && error ? (
        <Alert tone="error">{error}</Alert>
      ) : null}
    </AuthLayout>
  );
}
