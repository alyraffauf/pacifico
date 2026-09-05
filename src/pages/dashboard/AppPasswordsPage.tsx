import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loading,
  PageHeading,
  Select,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api, ApiError } from "../../lib/api.ts";
import { formatDate } from "../../lib/date.ts";
import { useTranslation } from "../../lib/i18n.ts";

const scopePresets = {
  full: undefined,
  readonly:
    "rpc:app.bsky.*?aud=* rpc:chat.bsky.*?aud=* account:status?action=read",
  posting: "repo:app.bsky.feed.post?action=create blob:*/*",
};

export function AppPasswordsPage() {
  const session = useSession();
  const t = useTranslation();
  const loadPasswords = useCallback(
    () => api.listAppPasswords(session.accessJwt),
    [session.accessJwt],
  );
  const passwords = useAsync(loadPasswords);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<keyof typeof scopePresets>("full");
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function createPassword(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const result = await api.createAppPassword(
        session.accessJwt,
        name.trim(),
        scopePresets[scope],
      );
      setCreatedPassword(result.password);
      setAcknowledged(false);
      setName("");
      await passwords.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not create the app password.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function removePassword(passwordName: string) {
    if (
      !window.confirm(t("appPasswords.deleteConfirm", { name: passwordName }))
    )
      return;
    setRevoking(passwordName);
    setError(null);
    try {
      await api.revokeAppPassword(session.accessJwt, passwordName);
      await passwords.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : t("appPasswords.deleteFailed"),
      );
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeading
        title={t("dashboard.navAppPasswords")}
        description={t("appPasswords.createdMessage")}
      />
      {createdPassword ? (
        <Alert tone="warning">
          <p className="font-semibold">{t("appPasswords.saveWarning")}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code className="flex-1 rounded bg-ctp-crust px-3 py-2 font-mono text-ctp-text">
              {createdPassword}
            </code>
            <Button
              variant="secondary"
              onClick={() =>
                void navigator.clipboard.writeText(createdPassword)
              }
            >
              {t("common.copyToClipboard")}
            </Button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />{" "}
            {t("appPasswords.acknowledgeLabel")}
          </label>
          <Button
            className="mt-3"
            variant="ghost"
            disabled={!acknowledged}
            onClick={() => setCreatedPassword(null)}
          >
            {t("common.done")}
          </Button>
        </Alert>
      ) : null}
      {error || passwords.error ? (
        <Alert tone="error">{error ?? passwords.error}</Alert>
      ) : null}
      <Card className="p-5">
        <form
          className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end"
          onSubmit={createPassword}
        >
          <Field label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Skyfeed on laptop"
            />
          </Field>
          <Field label="Permissions">
            <Select
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as keyof typeof scopePresets)
              }
            >
              <option value="full">Full account access</option>
              <option value="readonly">Read only</option>
              <option value="posting">Create posts</option>
            </Select>
          </Field>
          <Button disabled={creating || !name.trim()}>
            {creating ? "Creating" : "Create"}
          </Button>
        </form>
      </Card>
      {passwords.loading ? <Loading label="Loading app passwords" /> : null}
      {!passwords.loading && passwords.data?.passwords.length === 0 ? (
        <EmptyState>You have no app passwords.</EmptyState>
      ) : null}
      <div className="grid gap-3">
        {passwords.data?.passwords.map((password) => (
          <Card
            key={password.name}
            className="flex items-center justify-between gap-4 p-4"
          >
            <div>
              <h2 className="font-mono text-sm font-semibold text-ctp-text">
                {password.name}
              </h2>
              <p className="mt-1 text-xs text-ctp-overlay-1">
                Created {formatDate(password.createdAt)} ·{" "}
                {password.scopes ? "Scoped" : "Full access"}
              </p>
            </div>
            <Button
              variant="danger"
              disabled={revoking === password.name}
              onClick={() => void removePassword(password.name)}
            >
              {t("common.revoke")}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
