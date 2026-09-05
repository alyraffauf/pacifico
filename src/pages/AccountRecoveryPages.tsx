import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Alert, Button, Field, Input } from "../components/ui.tsx";
import { api, ApiError } from "../lib/api.ts";
import { unsafeAsDid, unsafeAsEmail } from "../lib/types/branded.ts";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await api.requestPasswordReset(unsafeAsEmail(identifier));
      setCodeSent(true);
      setMessage({
        tone: "success",
        text: "A reset code has been sent if that account exists.",
      });
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "Could not request a reset code.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function reset(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation)
      return setMessage({ tone: "error", text: "The passwords do not match." });
    setSubmitting(true);
    setMessage(null);
    try {
      await api.resetPassword(code.trim(), password);
      setMessage({
        tone: "success",
        text: "Password reset. You can sign in now.",
      });
      setTimeout(() => navigate("/app/login"), 1200);
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "Could not reset the password.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function requestAnotherCode() {
    setCodeSent(false);
    setCode("");
    setPassword("");
    setConfirmation("");
    setMessage(null);
  }

  return (
    <AuthLayout
      title={codeSent ? "Reset your password" : "Forgot your password?"}
      description={
        codeSent
          ? "Enter the code and choose a new password."
          : "Request a reset code using your handle or account email."
      }
    >
      <form className="grid gap-4" onSubmit={codeSent ? reset : requestCode}>
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        {codeSent ? (
          <>
            <Field label="Reset code">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </Field>
            <Field label="New password">
              <Input
                type="password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            <Field label="Confirm password">
              <Input
                type="password"
                minLength={8}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </Field>
          </>
        ) : (
          <Field label="Handle or email">
            <Input
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              required
            />
          </Field>
        )}
        <Button disabled={submitting}>
          {submitting
            ? "Working"
            : codeSent
              ? "Reset password"
              : "Send reset code"}
        </Button>
        {codeSent ? (
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={requestAnotherCode}
          >
            Request another code
          </Button>
        ) : null}
        <Link className="text-center text-sm" to="/app/login">
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  );
}

export function RequestPasskeyRecoveryPage() {
  const [identifier, setIdentifier] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.requestPasskeyRecovery(unsafeAsEmail(identifier));
      setSent(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not send a recovery link.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={sent ? "Check your inbox" : "Recover passkey access"}
      description={
        sent
          ? "If the account exists, a recovery link was sent to its verified address."
          : "Enter the account handle or verified email address."
      }
    >
      {sent ? (
        <div className="grid gap-4">
          <Alert tone="success">Recovery email requested.</Alert>
          <Link className="text-center text-sm" to="/app/login">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={submit}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field label="Handle or email">
            <Input
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Button disabled={submitting || !identifier.trim()}>
            {submitting ? "Sending" : "Send recovery link"}
          </Button>
          <Link className="text-center text-sm" to="/app/login">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function RecoverPasskeyPage() {
  const navigate = useNavigate();
  const parameters = new URLSearchParams(window.location.search);
  const did = parameters.get("did");
  const token = parameters.get("token");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recovered, setRecovered] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!did || !token) return;
    if (password !== confirmation)
      return setError("The passwords do not match.");
    setSubmitting(true);
    setError(null);
    try {
      await api.recoverPasskeyAccount(unsafeAsDid(did), token, password);
      setRecovered(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Recovery failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!did || !token) {
    return (
      <AuthLayout title="Invalid recovery link">
        <div className="grid gap-4">
          <Alert tone="error">This recovery link is incomplete.</Alert>
          <Button onClick={() => navigate("/app/login")}>
            Back to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }
  if (recovered) {
    return (
      <AuthLayout
        title="Account access restored"
        description="Sign in with the new password, then register a new passkey."
      >
        <Button onClick={() => navigate("/app/login")}>Sign in</Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title="Restore account access"
      description="Set a password so you can sign in and register a new passkey."
    >
      <form className="grid gap-4" onSubmit={submit}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field label="New password">
          <Input
            type="password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <Field label="Confirm password">
          <Input
            type="password"
            minLength={8}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </Field>
        <Button disabled={submitting || password.length < 8}>
          {submitting ? "Restoring access" : "Restore access"}
        </Button>
      </form>
    </AuthLayout>
  );
}
