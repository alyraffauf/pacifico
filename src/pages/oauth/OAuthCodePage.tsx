import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout.tsx";
import { Alert, Button, Field, Input } from "../../components/ui.tsx";
import { readJson, requestParameter } from "../../lib/http.ts";
import { getOAuthCodeEndpoint, getOAuthCodeMode } from "../../lib/pacifico/oauth-flow.ts";

export function OAuthCodePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestUri = requestParameter("request_uri");
  const channel = requestParameter("channel") || "your verification channel";
  const mode = getOAuthCodeMode(location.pathname);
  const isTotp = mode !== "channel";
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!requestUri) return setError("The authorization request is missing.");
    setSubmitting(true);
    try {
      const result = await readJson<{ redirect_uri?: string }>(await fetch(getOAuthCodeEndpoint(mode), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          request_uri: requestUri,
          code: isTotp ? code.trim().toUpperCase() : code.trim(),
          ...(mode === "totp" ? { trust_device: trustDevice } : {}),
        }),
      }));
      if (!result.redirect_uri) throw new Error("The authorization server returned no redirect.");
      window.location.assign(result.redirect_uri);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Verification failed.");
      setSubmitting(false);
    }
  }

  return <AuthLayout title={isTotp ? "Two-factor authentication" : "Enter your verification code"} description={isTotp ? "Enter the six-digit code from your authenticator, or an eight-character backup code." : `We sent a six-digit code through ${channel}.`}>
    <form className="grid gap-4" onSubmit={submit}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label={isTotp ? "Authenticator or backup code" : "Verification code"}><Input value={code} onChange={(event) => setCode(event.target.value)} maxLength={8} inputMode={isTotp ? "text" : "numeric"} autoComplete="one-time-code" autoFocus required /></Field>
      {mode === "totp" ? <label className="flex items-center gap-2 text-sm text-ctp-subtext-0"><input type="checkbox" checked={trustDevice} onChange={(event) => setTrustDevice(event.target.checked)} className="accent-ctp-lavender" /> Trust this device</label> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => navigate(requestUri ? `/app/oauth/login?request_uri=${encodeURIComponent(requestUri)}` : "/app/login")}>Cancel</Button><Button disabled={submitting || code.trim().length < 6}>{submitting ? "Verifying" : "Verify"}</Button></div>
    </form>
  </AuthLayout>;
}
