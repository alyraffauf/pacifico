import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Button, Field, Input } from "./ui.tsx";
import { api, ApiError } from "../lib/api.ts";
import { getValidToken } from "../lib/auth.ts";
import { useTranslation } from "../lib/i18n.ts";
import {
  prepareRequestOptions,
  serializeAssertionResponse,
  type WebAuthnRequestOptionsResponse,
} from "../lib/webauthn.ts";

type ReauthMethod = "password" | "totp" | "passkey";

interface ReauthDialogProps {
  methods: string[];
  onCancel: () => void;
  onSuccess: () => void | Promise<void>;
}

export function ReauthDialog({
  methods,
  onCancel,
  onSuccess,
}: ReauthDialogProps) {
  const t = useTranslation();
  const availableMethods = methods.filter((method): method is ReauthMethod =>
    ["password", "totp", "passkey"].includes(method),
  );
  const [activeMethod, setActiveMethod] = useState<ReauthMethod>(
    availableMethods[0] ?? "password",
  );
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusableSelector =
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
    dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          focusableSelector,
        ) ?? []),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [onCancel]);

  async function finishReauth(
    action: (
      token: Awaited<ReturnType<typeof getValidToken>>,
    ) => Promise<unknown>,
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getValidToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      await action(token);
      await onSuccess();
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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (activeMethod === "password") {
      void finishReauth((token) => api.reauthPassword(token!, password));
    } else if (activeMethod === "totp") {
      void finishReauth((token) =>
        api.reauthTotp(token!, totpCode.replace(/\s/g, "")),
      );
    }
  }

  async function usePasskey() {
    await finishReauth(async (token) => {
      if (!globalThis.PublicKeyCredential)
        throw new Error("This browser does not support passkeys.");
      const start = await api.reauthPasskeyStart(token!);
      const credential = await navigator.credentials.get({
        publicKey: prepareRequestOptions(
          start.options as unknown as WebAuthnRequestOptionsResponse,
        ),
      });
      if (!credential) throw new Error("Passkey verification was cancelled.");
      await api.reauthPasskeyFinish(
        token!,
        serializeAssertionResponse(credential as PublicKeyCredential),
      );
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ctp-crust/80 p-4 backdrop-blur"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onCancel()
      }
    >
      <dialog
        open
        ref={dialogRef}
        aria-labelledby="reauth-title"
        aria-modal="true"
        className="w-full max-w-md rounded border border-ctp-surface1 bg-ctp-mantle p-6 shadow-xl"
      >
        <h2
          id="reauth-title"
          className="font-mono text-xl font-bold text-ctp-text"
        >
          {t("reauth.title")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ctp-subtext0">
          This account change needs fresh authentication.
        </p>
        {error ? (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        {availableMethods.length > 1 ? (
          <div className="mt-5 flex gap-1 rounded bg-ctp-crust p-1">
            {availableMethods.map((method) => (
              <button
                type="button"
                key={method}
                className={`flex-1 rounded px-3 py-2 text-sm capitalize ${activeMethod === method ? "bg-ctp-surface0 text-ctp-text" : "text-ctp-subtext0"}`}
                onClick={() => setActiveMethod(method)}
              >
                {method}
              </button>
            ))}
          </div>
        ) : null}
        <form className="mt-5 grid gap-4" onSubmit={submit}>
          {activeMethod === "password" ? (
            <Field label={t("reauth.password")}>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
          ) : null}
          {activeMethod === "totp" ? (
            <Field label={t("reauth.authenticatorCode")}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                required
              />
            </Field>
          ) : null}
          {activeMethod === "passkey" ? (
            <p className="text-sm text-ctp-subtext0">
              Use a passkey registered to this account.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={submitting}
            >
              {t("reauth.cancel")}
            </Button>
            {activeMethod === "passkey" ? (
              <Button
                type="button"
                onClick={() => void usePasskey()}
                disabled={submitting}
              >
                {submitting
                  ? t("reauth.authenticating")
                  : t("reauth.usePasskey")}
              </Button>
            ) : (
              <Button
                disabled={
                  submitting ||
                  (activeMethod === "password"
                    ? !password
                    : totpCode.replace(/\s/g, "").length !== 6)
                }
              >
                {submitting ? "Verifying" : "Verify"}
              </Button>
            )}
          </div>
        </form>
      </dialog>
    </div>,
    document.body,
  );
}
