import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  Loading,
  PageHeading,
} from "../../components/ui.tsx";
import { useSession } from "../../hooks/useSession.ts";
import { api, ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/date.ts";
import { useTranslation } from "../../lib/i18n.ts";
import type {
  AccountInfo,
  AccountSearchResult,
  AdminInviteCode,
  ServerConfig,
  ServerStats,
} from "../../lib/types/api.ts";

import {
  AccountAdministrationSection,
  InviteCodeSection,
  ServerConfigurationSections,
  ServerSummary,
} from "./AdminSections.tsx";

type Notice = { tone: "success" | "error"; text: string };

function editableConfig(config: ServerConfig): ServerConfig {
  return {
    ...config,
    primaryColor: config.primaryColor ?? "",
    primaryColorDark: config.primaryColorDark ?? "",
    secondaryColor: config.secondaryColor ?? "",
    secondaryColorDark: config.secondaryColorDark ?? "",
  };
}

export function AdminPage() {
  const session = useSession();
  const t = useTranslation();
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<ServerConfig | null>(null);
  const [accounts, setAccounts] = useState<AccountSearchResult[]>([]);
  const [inviteCodes, setInviteCodes] = useState<AdminInviteCode[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AccountInfo | null>(null);
  const [signalLinked, setSignalLinked] = useState(false);
  const [signalQr, setSignalQr] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const signalPollErrors = useRef(0);
  const signalPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const signalTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const configChanged = useMemo(
    () =>
      Boolean(
        config &&
        savedConfig &&
        (JSON.stringify(config) !== JSON.stringify(savedConfig) || logoFile),
      ),
    [config, savedConfig, logoFile],
  );

  const stopSignalPolling = useCallback(() => {
    if (signalPollTimer.current) clearInterval(signalPollTimer.current);
    if (signalTimeout.current) clearTimeout(signalTimeout.current);
    signalPollTimer.current = null;
    signalTimeout.current = null;
  }, []);

  async function loadAccounts(reset = true) {
    const result = await api.searchAccounts(session.accessJwt, {
      handle: query.trim() || undefined,
      cursor: reset ? undefined : cursor,
      limit: 25,
    });
    setAccounts((current) =>
      reset ? result.accounts : [...current, ...result.accounts],
    );
    setCursor(result.cursor);
  }

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api.getServerStats(session.accessJwt),
      api.getServerConfig(),
      api.getSignalStatus(session.accessJwt),
      api.getInviteCodes(session.accessJwt, { limit: 25 }),
      api.searchAccounts(session.accessJwt, { limit: 25 }),
    ])
      .then(
        ([
          statsResult,
          configResult,
          signalResult,
          invitesResult,
          accountsResult,
        ]) => {
          if (!active) return;
          const failures: string[] = [];
          if (statsResult.status === "fulfilled") setStats(statsResult.value);
          else failures.push(t("admin.failedToLoadStats"));
          if (configResult.status === "fulfilled") {
            const nextConfig = editableConfig(configResult.value);
            setConfig(nextConfig);
            setSavedConfig(nextConfig);
            setLogoPreview(nextConfig.logoCid ? "/favicon.ico" : null);
          } else failures.push(t("admin.failedToLoadConfig"));
          if (signalResult.status === "fulfilled")
            setSignalLinked(signalResult.value.linked);
          else failures.push(t("admin.signalFailedToLoad"));
          if (invitesResult.status === "fulfilled")
            setInviteCodes(invitesResult.value.codes);
          if (accountsResult.status === "fulfilled") {
            setAccounts(accountsResult.value.accounts);
            setCursor(accountsResult.value.cursor);
          } else failures.push(t("admin.failedToLoadUsers"));
          if (failures.length > 0)
            setNotice({ tone: "error", text: failures.join(" ") });
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      stopSignalPolling();
    };
  }, [session.accessJwt, stopSignalPolling, t]);

  useEffect(
    () => () => {
      if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "success", text: success });
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

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    await run(async () => {
      const logoCid = logoFile
        ? (await api.uploadBlob(session.accessJwt, logoFile)).blob.ref.$link
        : (config.logoCid ?? "");
      await api.updateServerConfig(session.accessJwt, {
        serverName: config.serverName,
        primaryColor: config.primaryColor ?? "",
        primaryColorDark: config.primaryColorDark ?? "",
        secondaryColor: config.secondaryColor ?? "",
        secondaryColorDark: config.secondaryColorDark ?? "",
        logoCid,
      });
      const updated = editableConfig(await api.getServerConfig());
      setConfig(updated);
      setSavedConfig(updated);
      setLogoFile(null);
      setLogoPreview(updated.logoCid ? "/favicon.ico" : null);
    }, t("admin.configSaved"));
  }

  async function checkSignalStatus() {
    if (document.visibilityState === "hidden") return;
    try {
      const status = await api.getSignalStatus(session.accessJwt);
      signalPollErrors.current = 0;
      setSignalLinked(status.linked);
      if (status.linked) {
        setSignalQr(null);
        stopSignalPolling();
        setNotice({ tone: "success", text: t("admin.signalLinkSuccess") });
      }
    } catch (caught) {
      signalPollErrors.current += 1;
      if (signalPollErrors.current >= 3) {
        setSignalQr(null);
        stopSignalPolling();
        setNotice({
          tone: "error",
          text:
            caught instanceof ApiError
              ? caught.message
              : t("admin.signalFailedToLoad"),
        });
      }
    }
  }

  async function linkSignal() {
    await run(async () => {
      const result = await api.linkSignalDevice(session.accessJwt);
      signalPollErrors.current = 0;
      setSignalQr(result.qrBase64);
      stopSignalPolling();
      signalPollTimer.current = setInterval(
        () => void checkSignalStatus(),
        2000,
      );
      signalTimeout.current = setTimeout(() => {
        setSignalQr(null);
        stopSignalPolling();
        setNotice({ tone: "error", text: t("admin.signalLinkTimedOut") });
      }, 130_000);
    }, t("admin.signalLinking"));
  }

  async function openAccount(account: AccountSearchResult) {
    await run(
      async () =>
        setSelected(await api.getAccountInfo(session.accessJwt, account.did)),
      t("admin.userDetails"),
    );
  }

  if (loading) return <Loading />;

  return (
    <div className="grid gap-6">
      <PageHeading
        title={t("dashboard.navAdmin")}
        description={t("admin.userManagement")}
      />
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {stats ? (
        <ServerSummary
          stats={stats}
          labels={{
            users: t("admin.users"),
            repos: t("admin.repos"),
            records: t("admin.records"),
            blobStorage: t("admin.blobStorage"),
          }}
        />
      ) : null}

      <ServerConfigurationSections>
        {config ? (
          <Card className="p-5">
            <form className="grid gap-4" onSubmit={saveConfig}>
              <h2 className="font-mono font-semibold text-ctp-text">
                {t("admin.serverConfig")}
              </h2>
              <Field
                label={t("admin.serverName")}
                hint={t("admin.serverNameHelp")}
              >
                <Input
                  value={config.serverName}
                  onChange={(event) =>
                    setConfig({ ...config, serverName: event.target.value })
                  }
                />
              </Field>
              <Field label={t("admin.serverLogo")} hint={t("admin.logoHelp")}>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setLogoFile(file);
                    setLogoPreview(file ? URL.createObjectURL(file) : null);
                  }}
                />
              </Field>
              {logoPreview ? (
                <div>
                  <img
                    className="max-h-24 rounded object-contain"
                    src={logoPreview}
                    alt={t("admin.logoPreview")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2"
                    onClick={() => {
                      setLogoFile(null);
                      setLogoPreview(null);
                      setConfig({ ...config, logoCid: null });
                    }}
                  >
                    {t("admin.removeLogo")}
                  </Button>
                </div>
              ) : null}
              <fieldset className="grid gap-3">
                <legend className="font-mono text-sm text-ctp-subtext0">
                  {t("admin.themeColors")}
                </legend>
                <p className="text-xs text-ctp-overlay1">
                  {t("admin.themeColorsHint")}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["primaryColor", t("admin.primaryLight")],
                      ["primaryColorDark", t("admin.primaryDark")],
                      ["secondaryColor", t("admin.secondaryLight")],
                      ["secondaryColorDark", t("admin.secondaryDark")],
                    ] as const
                  ).map(([field, label]) => (
                    <Field key={field} label={label}>
                      <Input
                        value={config[field] ?? ""}
                        placeholder="#89b4fa"
                        onChange={(event) =>
                          setConfig({ ...config, [field]: event.target.value })
                        }
                      />
                    </Field>
                  ))}
                </div>
              </fieldset>
              <Button
                className="justify-self-start"
                disabled={busy || !configChanged}
              >
                {busy ? t("common.saving") : t("admin.saveConfig")}
              </Button>
            </form>
          </Card>
        ) : null}

        <Card className="p-5">
          <h2 className="font-mono font-semibold text-ctp-text">
            {t("admin.signalIntegration")}
          </h2>
          <p className="mt-1 text-sm text-ctp-subtext0">
            {signalLinked
              ? t("admin.signalLinked")
              : signalQr
                ? t("admin.signalLinking")
                : t("admin.signalNotLinked")}
          </p>
          {signalQr ? (
            <img
              className="mt-4 max-w-64 rounded bg-white p-3"
              src={
                signalQr.startsWith("data:")
                  ? signalQr
                  : `data:image/png;base64,${signalQr}`
              }
              alt={t("admin.signalLinking")}
            />
          ) : null}
          <div className="mt-5 flex gap-2">
            {signalLinked ? (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(t("admin.signalUnlinkConfirm")))
                    void run(async () => {
                      await api.unlinkSignalDevice(session.accessJwt);
                      setSignalLinked(false);
                    }, t("admin.signalUnlinkSuccess"));
                }}
              >
                {t("admin.signalUnlinkDevice")}
              </Button>
            ) : !signalQr ? (
              <Button disabled={busy} onClick={() => void linkSignal()}>
                {t("admin.signalLinkDevice")}
              </Button>
            ) : null}
          </div>
        </Card>
      </ServerConfigurationSections>

      <AccountAdministrationSection>
        <Card className="p-5">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => loadAccounts(true), t("common.refresh"));
            }}
          >
            <Field label={t("admin.search")}>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("admin.searchPlaceholder")}
              />
            </Field>
            <Button disabled={busy}>{t("admin.search")}</Button>
          </form>
        </Card>
        {accounts.length === 0 ? (
          <EmptyState>{t("admin.searchToSeeUsers")}</EmptyState>
        ) : (
          <Card className="overflow-x-auto">
            <DataTable>
              <thead>
                <tr>
                  <th>{t("admin.handle")}</th>
                  <th>{t("admin.did")}</th>
                  <th>{t("admin.created")}</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.did}>
                    <td className="font-mono text-ctp-text">
                      @{account.handle}
                    </td>
                    <td className="font-mono text-xs break-all text-ctp-subtext0">
                      {account.did}
                    </td>
                    <td>{formatDateTime(account.indexedAt)}</td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => void openAccount(account)}
                      >
                        {t("admin.userDetails")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        )}
        {cursor ? (
          <Button
            variant="secondary"
            className="justify-self-center"
            disabled={busy}
            onClick={() =>
              void run(() => loadAccounts(false), t("admin.loadMore"))
            }
          >
            {t("admin.loadMore")}
          </Button>
        ) : null}
      </AccountAdministrationSection>

      <InviteCodeSection>
        <h2 className="font-mono text-sm font-semibold text-ctp-lavender">
          {t("inviteCodes.yourCodes")}
        </h2>
        {inviteCodes.length === 0 ? (
          <EmptyState>{t("inviteCodes.noCodes")}</EmptyState>
        ) : (
          <Card className="divide-y divide-ctp-surface0">
            {inviteCodes.map((code) => (
              <div
                key={code.code}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <code
                    className={
                      code.disabled
                        ? "font-mono text-sm text-ctp-overlay1 line-through"
                        : "font-mono text-sm text-ctp-green"
                    }
                  >
                    {code.code}
                  </code>
                  <p className="mt-1 text-xs text-ctp-overlay1">
                    {t("inviteCodes.createdOn", {
                      date: formatDateTime(code.createdAt),
                    })}
                  </p>
                </div>
                {!code.disabled ? (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          t("inviteCodes.disableConfirm", { code: code.code }),
                        )
                      )
                        void run(async () => {
                          await api.disableInviteCodes(session.accessJwt, [
                            code.code,
                          ]);
                          setInviteCodes((items) =>
                            items.map((item) =>
                              item.code === code.code
                                ? { ...item, disabled: true }
                                : item,
                            ),
                          );
                        }, t("inviteCodes.disableSuccess"));
                    }}
                  >
                    {t("inviteCodes.disable")}
                  </Button>
                ) : null}
              </div>
            ))}
          </Card>
        )}
      </InviteCodeSection>

      {selected ? (
        <Card className="border-ctp-lavender/40 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-mono font-semibold text-ctp-text">
                @{selected.handle}
              </h2>
              <p className="mt-1 font-mono text-xs break-all text-ctp-overlay1">
                {selected.did}
              </p>
            </div>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              {t("common.cancel")}
            </Button>
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ctp-overlay1">{t("admin.email")}</dt>
              <dd>{selected.email ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-ctp-overlay1">{t("admin.invites")}</dt>
              <dd>
                {selected.invitesDisabled
                  ? t("admin.disabled")
                  : t("admin.enabled")}
              </dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(
                  async () => {
                    if (selected.invitesDisabled)
                      await api.enableAccountInvites(
                        session.accessJwt,
                        selected.did,
                      );
                    else
                      await api.disableAccountInvites(
                        session.accessJwt,
                        selected.did,
                      );
                    setSelected(
                      await api.getAccountInfo(session.accessJwt, selected.did),
                    );
                  },
                  selected.invitesDisabled
                    ? t("admin.invitesEnabled")
                    : t("admin.invitesDisabled"),
                )
              }
            >
              {selected.invitesDisabled
                ? t("admin.enableInvites")
                : t("admin.disableInvites")}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(t("admin.deleteConfirm", { handle: selected.handle }))
                )
                  void run(async () => {
                    await api.adminDeleteAccount(
                      session.accessJwt,
                      selected.did,
                    );
                    setSelected(null);
                    await loadAccounts(true);
                  }, t("admin.userDeleted"));
              }}
            >
              {t("admin.deleteAccount")}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
