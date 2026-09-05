import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
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
import { formatDateTime } from "../../lib/date.ts";
import {
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsScopeSet,
} from "../../lib/types/branded.ts";

type Notice = { tone: "success" | "error"; text: string };

export function DelegationPage() {
  const session = useSession();
  const loadDelegation = useCallback(async () => {
    const [controllers, accounts, presets, audit] = await Promise.all([
      api.listDelegationControllers(session.accessJwt),
      api.listDelegationControlledAccounts(session.accessJwt),
      api.getDelegationScopePresets(),
      api.getDelegationAuditLog(session.accessJwt, 20, 0),
    ]);
    if (!controllers.ok) throw controllers.error;
    if (!accounts.ok) throw accounts.error;
    if (!presets.ok) throw presets.error;
    if (!audit.ok) throw audit.error;
    return {
      controllers: controllers.value.controllers,
      accounts: accounts.value.accounts,
      presets: presets.value.presets,
      audit: audit.value,
    };
  }, [session.accessJwt]);
  const resource = useAsync(loadDelegation);
  const [identifier, setIdentifier] = useState("");
  const [resolved, setResolved] = useState<{
    did: string;
    handle?: string;
    isLocal: boolean;
  } | null>(null);
  const [scope, setScope] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [createScope, setCreateScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fallbackScope =
    resource.data?.presets.find((preset) => preset.name === "owner")?.scopes ??
    resource.data?.presets[0]?.scopes ??
    "";
  const selectedScope = scope || fallbackScope;
  const selectedCreateScope = createScope || fallbackScope;

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "success", text: success });
      await resource.reload();
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof ApiError ? caught.message : "The request failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    setBusy(true);
    setNotice(null);
    setResolved(null);
    try {
      const result = await api.resolveController(
        identifier.trim().replace(/^@/, ""),
      );
      if (!result.ok) throw result.error;
      setResolved(result.value);
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "No matching account was found.",
      });
    } finally {
      setBusy(false);
    }
  }

  const hasControllers = Boolean(resource.data?.controllers.length);
  const controlsAccounts = Boolean(resource.data?.accounts.length);

  return (
    <div className="grid gap-6">
      <PageHeading
        title="Delegation"
        description="Grant account access or open an account you manage."
      />
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {resource.error ? <Alert tone="error">{resource.error}</Alert> : null}
      {resource.loading ? (
        <Loading />
      ) : resource.data ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-mono font-semibold text-ctp-text">
                Grant access
              </h2>
              {controlsAccounts ? (
                <div className="mt-4">
                  <Alert tone="warning">
                    An account that controls others cannot also be controlled.
                  </Alert>
                </div>
              ) : (
                <div className="mt-4 grid gap-4">
                  <div className="flex gap-2">
                    <Input
                      value={identifier}
                      onChange={(event) => {
                        setIdentifier(event.target.value);
                        setResolved(null);
                      }}
                      placeholder="handle or DID"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy || !identifier.trim()}
                      onClick={() => void resolve()}
                    >
                      Find
                    </Button>
                  </div>
                  {resolved ? (
                    <div className="rounded border border-ctp-surface-1 bg-ctp-base p-3 text-sm">
                      <p className="font-mono text-ctp-text">
                        {resolved.handle ? `@${resolved.handle}` : resolved.did}
                      </p>
                      <p className="mt-1 text-xs break-all text-ctp-overlay-1">
                        {resolved.did} · {resolved.isLocal ? "local" : "remote"}
                      </p>
                    </div>
                  ) : null}
                  <Field label="Access level">
                    <Select
                      value={selectedScope}
                      onChange={(event) => setScope(event.target.value)}
                    >
                      {resource.data.presets.map((preset) => (
                        <option key={preset.name} value={preset.scopes}>
                          {preset.name} — {preset.description}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    disabled={busy || !resolved}
                    onClick={() =>
                      void run(async () => {
                        const result = await api.addDelegationController(
                          session.accessJwt,
                          unsafeAsDid(resolved!.did),
                          unsafeAsScopeSet(selectedScope),
                        );
                        if (!result.ok) throw result.error;
                        setIdentifier("");
                        setResolved(null);
                      }, "Access granted.")
                    }
                  >
                    Add controller
                  </Button>
                </div>
              )}
            </Card>
            <Card className="p-5">
              <h2 className="font-mono font-semibold text-ctp-text">
                Create a managed account
              </h2>
              {hasControllers ? (
                <div className="mt-4">
                  <Alert tone="warning">
                    A controlled account cannot create accounts of its own.
                  </Alert>
                </div>
              ) : (
                <div className="mt-4 grid gap-4">
                  <Field label="Handle">
                    <Input
                      value={handle}
                      onChange={(event) => setHandle(event.target.value)}
                      placeholder="name.example.com"
                    />
                  </Field>
                  <Field label="Email" hint="Optional">
                    <Input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </Field>
                  <Field label="Your access">
                    <Select
                      value={selectedCreateScope}
                      onChange={(event) => setCreateScope(event.target.value)}
                    >
                      {resource.data.presets.map((preset) => (
                        <option key={preset.name} value={preset.scopes}>
                          {preset.name} — {preset.description}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    disabled={busy || !handle.trim()}
                    onClick={() =>
                      void run(async () => {
                        const result = await api.createDelegatedAccount(
                          session.accessJwt,
                          unsafeAsHandle(handle.trim()),
                          email.trim()
                            ? unsafeAsEmail(email.trim())
                            : undefined,
                          unsafeAsScopeSet(selectedCreateScope),
                        );
                        if (!result.ok) throw result.error;
                        setHandle("");
                        setEmail("");
                      }, "Managed account created.")
                    }
                  >
                    Create account
                  </Button>
                </div>
              )}
            </Card>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="grid content-start gap-3">
              <h2 className="font-mono text-sm font-semibold text-ctp-lavender">
                Controllers
              </h2>
              {resource.data.controllers.length === 0 ? (
                <EmptyState>No one else can control this account.</EmptyState>
              ) : (
                resource.data.controllers.map((controller) => (
                  <Card key={controller.did} className="p-4">
                    <p className="font-mono text-sm text-ctp-text">
                      {controller.handle
                        ? `@${controller.handle}`
                        : controller.did}
                    </p>
                    <p className="mt-1 text-xs break-all text-ctp-overlay-1">
                      {controller.grantedScopes || "Viewer"} · added{" "}
                      {formatDateTime(controller.grantedAt)}
                    </p>
                    <Button
                      variant="danger"
                      className="mt-4"
                      disabled={busy}
                      onClick={() => {
                        if (confirm("Remove this controller?"))
                          void run(async () => {
                            const result = await api.removeDelegationController(
                              session.accessJwt,
                              controller.did,
                            );
                            if (!result.ok) throw result.error;
                          }, "Controller removed.");
                      }}
                    >
                      Remove
                    </Button>
                  </Card>
                ))
              )}
            </section>
            <section className="grid content-start gap-3">
              <h2 className="font-mono text-sm font-semibold text-ctp-lavender">
                Managed accounts
              </h2>
              {resource.data.accounts.length === 0 ? (
                <EmptyState>You do not manage another account.</EmptyState>
              ) : (
                resource.data.accounts.map((account) => (
                  <Card key={account.did} className="p-4">
                    <p className="font-mono text-sm text-ctp-text">
                      {account.handle ? `@${account.handle}` : account.did}
                    </p>
                    <p className="mt-1 text-xs break-all text-ctp-overlay-1">
                      {account.grantedScopes || "Viewer"}
                    </p>
                    <Link
                      className="mt-4 inline-flex min-h-10 items-center rounded border border-ctp-lavender px-4 py-2 text-sm font-semibold text-ctp-lavender hover:bg-ctp-lavender/10"
                      to={`/app/act-as?did=${encodeURIComponent(account.did)}`}
                    >
                      Open account
                    </Link>
                  </Card>
                ))
              )}
            </section>
          </div>
          <section className="grid gap-3">
            <h2 className="font-mono text-sm font-semibold text-ctp-lavender">
              Recent activity
            </h2>
            {resource.data.audit.entries.length === 0 ? (
              <EmptyState>No delegation activity yet.</EmptyState>
            ) : (
              <Card className="divide-y divide-ctp-surface-0">
                {resource.data.audit.entries.map((entry) => (
                  <div key={entry.id} className="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-mono text-sm text-ctp-text">
                        {entry.action}
                      </p>
                      <time className="text-xs text-ctp-overlay-1">
                        {formatDateTime(entry.created_at)}
                      </time>
                    </div>
                    <p className="mt-1 text-xs break-all text-ctp-subtext-0">
                      {entry.actor_did}
                      {entry.target_did ? ` → ${entry.target_did}` : ""}
                    </p>
                    {entry.details ? (
                      <p className="mt-2 text-xs text-ctp-overlay-1">
                        {entry.details}
                      </p>
                    ) : null}
                  </div>
                ))}
              </Card>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
