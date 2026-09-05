import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ChannelVerificationPrompt,
  hasBotVerification,
} from "../../components/ChannelVerificationPrompt.tsx";
import {
  Alert,
  Button,
  DashboardPage,
  Field,
  Input,
  Select,
  SettingsDialog,
  SettingsItem,
  SettingsRow,
  SettingsSection,
  SettingsTag,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { refreshSession } from "../../lib/auth.ts";
import { api, ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/date.ts";
import { useTranslation } from "../../lib/i18n.ts";
import { getChangedMessagingUsernames } from "../../lib/pacifico/communication.ts";
import type { VerificationChannel } from "../../lib/types/api.ts";

const channels: VerificationChannel[] = [
  "email",
  "discord",
  "telegram",
  "signal",
];
const usernameChannels = ["discord", "telegram", "signal"] as const;
type UsernameChannel = (typeof usernameChannels)[number];
type PendingVerification = {
  channel: UsernameChannel;
  identifier: string;
  code: string;
};

function isUsernameChannel(channel: string): channel is UsernameChannel {
  return (
    channel === "discord" || channel === "telegram" || channel === "signal"
  );
}

export type CommunicationPageApi = Pick<
  typeof api,
  | "checkChannelVerified"
  | "confirmChannelVerification"
  | "describeServer"
  | "getNotificationHistory"
  | "getNotificationPrefs"
  | "updateNotificationPrefs"
>;

interface CommunicationPageProps {
  apiClient?: CommunicationPageApi;
  refreshAccountSession?: () => Promise<unknown>;
}

export function CommunicationPage({
  apiClient = api,
  refreshAccountSession = refreshSession,
}: CommunicationPageProps = {}) {
  const session = useSession();
  const t = useTranslation();
  const loadCommunication = useCallback(async () => {
    const [prefs, server, history] = await Promise.all([
      apiClient.getNotificationPrefs(session.accessJwt),
      apiClient.describeServer(),
      apiClient.getNotificationHistory(session.accessJwt),
    ]);
    return { prefs, server, history: history.notifications };
  }, [apiClient, session.accessJwt]);
  const {
    data: communicationData,
    error: communicationError,
    loading: communicationLoading,
    reload: reloadCommunication,
  } = useAsync(loadCommunication);
  const [preferredChannel, setPreferredChannel] =
    useState<VerificationChannel>("email");
  const [usernames, setUsernames] = useState({
    discord: "",
    telegram: "",
    signal: "",
  });
  const [savedUsernames, setSavedUsernames] = useState({
    discord: "",
    telegram: "",
    signal: "",
  });
  const [verifications, setVerifications] = useState<PendingVerification[]>([]);
  const [verificationDialogChannel, setVerificationDialogChannel] =
    useState<UsernameChannel | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const verificationCodeInput = useRef<HTMLInputElement>(null);
  const [synchronizedData, setSynchronizedData] =
    useState<typeof communicationData>(null);

  if (communicationData && synchronizedData !== communicationData) {
    const loadedUsernames = {
      discord: communicationData.prefs.discordUsername ?? "",
      telegram: communicationData.prefs.telegramUsername ?? "",
      signal: communicationData.prefs.signalUsername ?? "",
    };
    setSynchronizedData(communicationData);
    setPreferredChannel(communicationData.prefs.preferredChannel);
    setUsernames(loadedUsernames);
    setSavedUsernames(loadedUsernames);
    setVerifications([
      ...(!communicationData.prefs.discordVerified && loadedUsernames.discord
        ? [
            {
              channel: "discord" as const,
              identifier: loadedUsernames.discord,
              code: "",
            },
          ]
        : []),
      ...(!communicationData.prefs.telegramVerified && loadedUsernames.telegram
        ? [
            {
              channel: "telegram" as const,
              identifier: loadedUsernames.telegram,
              code: "",
            },
          ]
        : []),
      ...(!communicationData.prefs.signalVerified && loadedUsernames.signal
        ? [
            {
              channel: "signal" as const,
              identifier: loadedUsernames.signal,
              code: "",
            },
          ]
        : []),
    ]);
  }

  const activeVerification = verificationDialogChannel
    ? verifications.find(({ channel }) => channel === verificationDialogChannel)
    : undefined;

  const channelLabel = useCallback(
    (channel: VerificationChannel) => {
      switch (channel) {
        case "email":
          return t("register.email");
        case "discord":
          return t("register.discord");
        case "telegram":
          return t("register.telegram");
        case "signal":
          return t("register.signal");
      }
    },
    [t],
  );

  useEffect(() => {
    if (!activeVerification || !hasBotVerification(activeVerification.channel))
      return;

    let checking = false;
    const interval = globalThis.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await apiClient.checkChannelVerified(
          session.did,
          activeVerification.channel,
        );
        if (!result.verified) return;
        setVerifications((current) =>
          current.filter(
            ({ channel }) => channel !== activeVerification.channel,
          ),
        );
        setVerificationDialogChannel(null);
        setMessage({
          tone: "success",
          text: t("comms.verifiedSuccess", {
            channel: channelLabel(activeVerification.channel),
          }),
        });
        await refreshAccountSession();
        await reloadCommunication();
      } catch {
        // Bot verification is asynchronous. The next check can recover.
      } finally {
        checking = false;
      }
    }, 3000);
    return () => globalThis.clearInterval(interval);
  }, [
    activeVerification,
    apiClient,
    channelLabel,
    refreshAccountSession,
    reloadCommunication,
    session.did,
    t,
  ]);

  function channelInputLabel(channel: UsernameChannel) {
    switch (channel) {
      case "discord":
        return t("register.discordUsername");
      case "telegram":
        return t("register.telegramUsername");
      case "signal":
        return t("register.signalUsername");
    }
  }

  function channelPlaceholder(channel: UsernameChannel) {
    switch (channel) {
      case "discord":
        return t("register.discordUsernamePlaceholder");
      case "telegram":
        return t("register.telegramUsernamePlaceholder");
      case "signal":
        return t("register.signalUsernamePlaceholder");
    }
  }

  function isAvailable(candidate: VerificationChannel) {
    return (
      communicationData?.server.availableCommsChannels ?? ["email"]
    ).includes(candidate);
  }

  function isVerified(candidate: VerificationChannel): boolean {
    if (candidate === "email") return true;
    const prefs = communicationData?.prefs;
    if (!prefs || usernames[candidate] !== savedUsernames[candidate])
      return false;
    const verifiedByChannel: Record<UsernameChannel, boolean> = {
      discord: prefs.discordVerified,
      telegram: prefs.telegramVerified,
      signal: prefs.signalVerified,
    };
    return verifiedByChannel[candidate];
  }

  function channelStatus(channel: UsernameChannel) {
    if (!isAvailable(channel)) return t("comms.unavailable");
    if (!usernames[channel]) return t("comms.notConfigured");
    return isVerified(channel) ? t("comms.verified") : t("comms.notVerified");
  }

  function channelDescription(channel: UsernameChannel) {
    if (!isAvailable(channel)) return t("comms.notConfiguredOnServer");
    if (!usernames[channel]) return t("comms.configureToEnable");
    return undefined;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiClient.updateNotificationPrefs(
        session.accessJwt,
        {
          preferredChannel,
          ...getChangedMessagingUsernames(usernames, savedUsernames),
        },
      );
      const required = result.verificationRequired
        .filter(isUsernameChannel)
        .map((channel) => ({
          channel,
          identifier: usernames[channel],
          code: "",
        }));
      setVerifications(required);
      setVerificationDialogChannel(required[0]?.channel ?? null);
      setMessage({
        tone: "success",
        text: required.length
          ? t("comms.verificationRequired")
          : t("comms.preferencesSaved"),
      });
      await refreshAccountSession();
      await reloadCommunication();
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof ApiError ? caught.message : t("comms.failedToSave"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeVerification) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.confirmChannelVerification(
        session.accessJwt,
        activeVerification.channel,
        activeVerification.identifier,
        activeVerification.code,
      );
      setVerifications((current) =>
        current.filter(({ channel }) => channel !== activeVerification.channel),
      );
      setVerificationDialogChannel(null);
      setMessage({
        tone: "success",
        text: t("comms.verifiedSuccess", {
          channel: channelLabel(activeVerification.channel),
        }),
      });
      await refreshAccountSession();
      await reloadCommunication();
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : t("comms.failedToVerify"),
      });
    } finally {
      setBusy(false);
    }
  }

  function updateVerificationCode(code: string) {
    if (!activeVerification) return;
    setVerifications((current) =>
      current.map((verification) =>
        verification.channel === activeVerification.channel
          ? { ...verification, code }
          : verification,
      ),
    );
  }

  const loaded = communicationData;
  const hasUnsavedChanges = loaded
    ? preferredChannel !== loaded.prefs.preferredChannel ||
      usernameChannels.some(
        (channel) => usernames[channel] !== savedUsernames[channel],
      )
    : false;
  if (communicationLoading && !loaded) {
    return (
      <DashboardPage
        title={t("dashboard.navComms")}
        description={t("comms.description")}
        busy
      >
        <SettingsSection title={t("comms.channelConfiguration")}>
          <SettingsRow label={t("comms.preferredChannel")} />
          <SettingsRow label={t("register.email")} />
          <SettingsRow label={t("register.discord")} />
        </SettingsSection>
      </DashboardPage>
    );
  }

  if (!loaded) {
    return (
      <DashboardPage
        title={t("dashboard.navComms")}
        description={t("comms.description")}
      >
        <Alert tone="error">
          {communicationError ?? t("comms.failedToLoad")}
        </Alert>
      </DashboardPage>
    );
  }

  return (
    <DashboardPage
      title={t("dashboard.navComms")}
      description={t("comms.description")}
    >
      {message && !(activeVerification && message.tone === "error") ? (
        <Alert tone={message.tone}>{message.text}</Alert>
      ) : null}
      {communicationError ? (
        <Alert tone="error">{communicationError}</Alert>
      ) : null}

      <form id="communication-preferences" onSubmit={save}>
        <SettingsSection
          title={t("comms.channelConfiguration")}
          description={t("comms.channelConfigurationDescription")}
        >
          <SettingsRow
            label={t("comms.preferredChannel")}
            value={
              <Select
                compact
                aria-label={t("comms.preferredChannel")}
                value={preferredChannel}
                disabled={busy}
                onChange={(event) =>
                  setPreferredChannel(event.target.value as VerificationChannel)
                }
              >
                {channels.map((channel) => (
                  <option
                    key={channel}
                    value={channel}
                    disabled={
                      !isAvailable(channel) ||
                      (channel !== "email" && !usernames[channel])
                    }
                  >
                    {channelLabel(channel)}
                    {!isAvailable(channel)
                      ? ` (${t("comms.unavailable")})`
                      : channel !== "email" && !isVerified(channel)
                        ? ` (${t("comms.notVerified")})`
                        : ""}
                  </option>
                ))}
              </Select>
            }
          />
          <SettingsRow
            label={channelLabel("email")}
            value={loaded.prefs.email}
            technical
            stackActionOnMobile
            action={
              <div className="flex flex-wrap gap-2 sm:w-36 sm:justify-end">
                {preferredChannel === "email" ? (
                  <SettingsTag tone="accent">{t("comms.primary")}</SettingsTag>
                ) : null}
                <SettingsTag>{t("comms.verified")}</SettingsTag>
              </div>
            }
          />
          {usernameChannels.map((channel) => {
            const pendingVerification = verifications.some(
              (verification) => verification.channel === channel,
            );
            return (
              <SettingsRow
                key={channel}
                label={channelLabel(channel)}
                value={
                  <label>
                    <span className="sr-only">
                      {channelInputLabel(channel)}
                    </span>
                    <Input
                      className="py-2.5 font-mono text-sm"
                      value={usernames[channel]}
                      placeholder={channelPlaceholder(channel)}
                      disabled={busy || !isAvailable(channel)}
                      autoComplete="off"
                      onChange={(event) =>
                        setUsernames((current) => ({
                          ...current,
                          [channel]: event.target.value,
                        }))
                      }
                    />
                  </label>
                }
                description={channelDescription(channel)}
                stackActionOnMobile
                action={
                  <div className="flex flex-wrap items-center gap-1 sm:w-36 sm:justify-end">
                    {preferredChannel === channel ? (
                      <SettingsTag tone="accent">
                        {t("comms.primary")}
                      </SettingsTag>
                    ) : null}
                    <SettingsTag
                      tone={isVerified(channel) ? "accent" : "neutral"}
                    >
                      {channelStatus(channel)}
                    </SettingsTag>
                    {pendingVerification && !isVerified(channel) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="compact"
                        aria-haspopup="dialog"
                        onClick={() => setVerificationDialogChannel(channel)}
                      >
                        {t("common.verify")}
                      </Button>
                    ) : null}
                  </div>
                }
              />
            );
          })}
        </SettingsSection>
        <div className="mt-3 flex justify-end px-1">
          <Button type="submit" disabled={busy || !hasUnsavedChanges}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </form>

      <SettingsSection title={t("comms.messageHistory")}>
        {loaded.history.map((item) => (
          <SettingsItem
            key={`${item.createdAt}-${item.channel}-${item.notificationType}-${item.subject ?? ""}`}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span>{item.subject || item.notificationType}</span>
                <SettingsTag
                  tone={
                    item.status.toLowerCase() === "delivered"
                      ? "accent"
                      : "neutral"
                  }
                >
                  {item.status}
                </SettingsTag>
              </span>
            }
            description={
              <span className="grid gap-2">
                <span className="font-mono">
                  {channelLabel(item.channel)} ·{" "}
                  {formatDateTime(item.createdAt)}
                </span>
                <span className="text-sm leading-6 whitespace-pre-wrap text-ctp-subtext0">
                  {item.body}
                </span>
              </span>
            }
          />
        ))}
        {loaded.history.length === 0 ? (
          <SettingsItem title={t("comms.noMessages")} />
        ) : null}
      </SettingsSection>

      <SettingsDialog
        open={Boolean(activeVerification)}
        title={
          activeVerification
            ? t("comms.verifyChannel", {
                channel: channelLabel(activeVerification.channel),
              })
            : t("common.verify")
        }
        description={
          activeVerification
            ? t("comms.verifyDescription", {
                identifier: activeVerification.identifier,
              })
            : undefined
        }
        initialFocusRef={
          activeVerification && !hasBotVerification(activeVerification.channel)
            ? verificationCodeInput
            : undefined
        }
        maxWidth="sm"
        closeDisabled={busy}
        onClose={() => setVerificationDialogChannel(null)}
      >
        {activeVerification && message?.tone === "error" ? (
          <div className="mb-4">
            <Alert tone="error">{message.text}</Alert>
          </div>
        ) : null}
        {activeVerification ? (
          hasBotVerification(activeVerification.channel) ? (
            <ChannelVerificationPrompt
              channel={activeVerification.channel}
              handle={session.handle}
              server={loaded.server}
            />
          ) : (
            <form className="grid gap-4" onSubmit={confirmVerification}>
              <Field label={t("settings.verificationCode")}>
                <Input
                  ref={verificationCodeInput}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={activeVerification.code}
                  placeholder={t("comms.verifyCodePlaceholder")}
                  disabled={busy}
                  onChange={(event) =>
                    updateVerificationCode(event.target.value)
                  }
                />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setVerificationDialogChannel(null)}
                >
                  {t("common.cancel")}
                </Button>
                <Button disabled={busy || !activeVerification.code.trim()}>
                  {busy ? t("common.verifying") : t("common.verify")}
                </Button>
              </div>
            </form>
          )
        ) : null}
      </SettingsDialog>
    </DashboardPage>
  );
}
