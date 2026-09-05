import { IconArrowRight, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Alert, Button, Loading } from "../components/ui.tsx";
import { forgetAccount, loginWithOAuth, switchAccount } from "../lib/auth.ts";
import { isErr } from "../lib/types/result.ts";
import type { Did } from "../lib/types/branded.ts";
import { useAuthState } from "../hooks/useAuthState.ts";
import { useTranslation } from "../lib/i18n.ts";

export function LoginPage() {
  const auth = useAuthState();
  const t = useTranslation();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startLogin() {
    setSubmitting(true);
    setError(null);
    const result = await loginWithOAuth();
    if (isErr(result)) {
      setError(result.error.message);
      setSubmitting(false);
    }
  }

  async function chooseAccount(did: Did) {
    setSubmitting(true);
    const result = await switchAccount(did);
    if (isErr(result)) {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }
    navigate("/app/settings");
  }

  if (auth.kind === "loading" && auth.savedAccounts.length === 0) {
    return (
      <AuthLayout title={t("common.checking")}>
        <Loading label={t("common.loading")} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("login.title")}>
      <div className="grid gap-5">
        {error || auth.kind === "error" ? (
          <Alert tone="error">
            {error ??
              (auth.kind === "error" ? auth.error.message : "Sign-in failed.")}
          </Alert>
        ) : null}

        {auth.savedAccounts.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-xs font-semibold tracking-wide text-ctp-overlay-1 uppercase">
              {t("login.chooseAccount")}
            </p>
            {auth.savedAccounts.map((account) => (
              <div
                key={account.did}
                className="flex items-center rounded border border-ctp-surface-1 bg-ctp-crust p-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 px-2 py-1 text-left"
                  onClick={() => void chooseAccount(account.did)}
                  disabled={submitting}
                >
                  <span className="block truncate font-mono text-sm font-semibold text-ctp-text">
                    @{account.handle}
                  </span>
                  <span className="block truncate font-mono text-xs text-ctp-overlay-1">
                    {account.did}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2"
                  aria-label={`Forget ${account.handle}`}
                  onClick={() => forgetAccount(account.did)}
                >
                  <IconTrash className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <Button
          type="button"
          className="w-full"
          onClick={() => void startLogin()}
          disabled={submitting}
        >
          {submitting ? t("login.redirecting") : t("login.button")}
          <IconArrowRight className="size-4" aria-hidden="true" />
        </Button>

        <div className="flex flex-wrap justify-center gap-x-3 gap-y-2 text-sm">
          <Link to="/app/reset-password">{t("login.forgotPassword")}</Link>
          <Link to="/app/request-passkey-recovery">
            {t("login.lostPasskey")}
          </Link>
          <Link to="/app/register">{t("login.createAccount")}</Link>
        </div>
      </div>
    </AuthLayout>
  );
}
