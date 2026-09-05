import { useCallback, useEffect, useState } from "react";
import {
  ChannelVerificationPrompt,
  hasBotVerification,
} from "../../components/ChannelVerificationPrompt.tsx";
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
import { refreshSession } from "../../lib/auth.ts";
import { api, ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/date.ts";
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

function isUsernameChannel(channel: string): channel is UsernameChannel {
  return (
    channel === "discord" || channel === "telegram" || channel === "signal"
  );
}

export function CommunicationPage() {
  const session = useSession();
  const loadCommunication = useCallback(async () => {
    const [prefs, server, history] = await Promise.all([
      api.getNotificationPrefs(session.accessJwt),
      api.describeServer(),
      api.getNotificationHistory(session.accessJwt),
    ]);
    return { prefs, server, history: history.notifications };
  }, [session.accessJwt]);
  const {
    data: communicationData,
    error: communicationError,
    loading: communicationLoading,
    reload: reloadCommunication,
  } = useAsync(loadCommunication);
  const [channel, setChannel] = useState<VerificationChannel>("email");
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
  const [verifications, setVerifications] = useState<
    Array<{ channel: VerificationChannel; identifier: string; code: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!communicationData) return;
    const loaded = communicationData;
    const loadedUsernames = {
      discord: loaded.prefs.discordUsername ?? "",
      telegram: loaded.prefs.telegramUsername ?? "",
      signal: loaded.prefs.signalUsername ?? "",
    };
    queueMicrotask(() => {
      setChannel(loaded.prefs.preferredChannel);
      setUsernames(loadedUsernames);
      setSavedUsernames(loadedUsernames);
      setVerifications([
        ...(!loaded.prefs.discordVerified && loadedUsernames.discord
          ? [
              {
                channel: "discord" as const,
                identifier: loadedUsernames.discord,
                code: "",
              },
            ]
          : []),
        ...(!loaded.prefs.telegramVerified && loadedUsernames.telegram
          ? [
              {
                channel: "telegram" as const,
                identifier: loadedUsernames.telegram,
                code: "",
              },
            ]
          : []),
        ...(!loaded.prefs.signalVerified && loadedUsernames.signal
          ? [
              {
                channel: "signal" as const,
                identifier: loadedUsernames.signal,
                code: "",
              },
            ]
          : []),
      ]);
    });
  }, [communicationData]);

  useEffect(() => {
    if (!communicationData || verifications.length === 0) return;
    const botVerifications = verifications.filter(
      ({ channel: pendingChannel }) => hasBotVerification(pendingChannel),
    );
    if (botVerifications.length === 0) return;
    let checking = false;
    const interval = globalThis.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const results = await Promise.all(
          botVerifications.map(async (pending) => ({
            pending,
            result: await api.checkChannelVerified(
              session.did,
              pending.channel,
            ),
          })),
        );
        const completedChannels = new Set(
          results
            .filter(({ result }) => result.verified)
            .map(({ pending }) => pending.channel),
        );
        if (completedChannels.size > 0) {
          setVerifications((current) =>
            current.filter(
              ({ channel: pendingChannel }) =>
                !completedChannels.has(pendingChannel),
            ),
          );
          setMessage({
            tone: "success",
            text: `${[...completedChannels].join(" and ")} verified.`,
          });
          await refreshSession();
          await reloadCommunication();
        }
      } catch {
        // Polling is best effort. The next interval retries without interrupting the form.
      } finally {
        checking = false;
      }
    }, 3000);
    return () => globalThis.clearInterval(interval);
  }, [communicationData, reloadCommunication, session.did, verifications]);

  function isAvailable(candidate: VerificationChannel) {
    return (
      communicationData?.server.availableCommsChannels ?? ["email"]
    ).includes(candidate);
  }

  function isVerified(candidate: VerificationChannel): boolean {
    if (candidate === "email") return true;
    const prefs = communicationData?.prefs;
    if (!prefs) return false;
    const verifiedByChannel: Record<UsernameChannel, boolean> = {
      discord: prefs.discordVerified,
      telegram: prefs.telegramVerified,
      signal: prefs.signalVerified,
    };
    return verifiedByChannel[candidate];
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.updateNotificationPrefs(session.accessJwt, {
        preferredChannel: channel,
        ...getChangedMessagingUsernames(usernames, savedUsernames),
      });
      const required = result.verificationRequired
        .filter(isUsernameChannel)
        .map((pendingChannel) => ({
          channel: pendingChannel,
          identifier: usernames[pendingChannel],
          code: "",
        }));
      setVerifications(required);
      setMessage({
        tone: "success",
        text: required.length
          ? "Saved. Complete the verification steps below."
          : "Notification settings saved.",
      });
      await refreshSession();
      await reloadCommunication();
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "Could not save notification settings.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmVerification(event: React.FormEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const pendingChannel = form.get("channel") as VerificationChannel;
    const verify = verifications.find(
      ({ channel: itemChannel }) => itemChannel === pendingChannel,
    );
    if (!verify) return;
    setBusy(true);
    try {
      await api.confirmChannelVerification(
        session.accessJwt,
        verify.channel,
        verify.identifier,
        verify.code,
      );
      setVerifications((current) =>
        current.filter(
          ({ channel: itemChannel }) => itemChannel !== verify.channel,
        ),
      );
      setMessage({ tone: "success", text: `${verify.channel} verified.` });
      await refreshSession();
      await reloadCommunication();
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "The code was not accepted.",
      });
    } finally {
      setBusy(false);
    }
  }

  const loaded = communicationData;
  return (
    <div className="grid gap-6">
      <PageHeading
        title="Communication"
        description="Choose where account and security messages are sent."
      />
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {communicationError ? (
        <Alert tone="error">{communicationError}</Alert>
      ) : null}
      {communicationLoading ? (
        <Loading />
      ) : loaded ? (
        <>
          <Card className="p-5">
            <form className="grid max-w-2xl gap-5" onSubmit={save}>
              <Field label="Preferred channel">
                <Select
                  value={channel}
                  onChange={(event) =>
                    setChannel(event.target.value as VerificationChannel)
                  }
                >
                  {channels.map((item) => (
                    <option
                      key={item}
                      value={item}
                      disabled={
                        !isAvailable(item) ||
                        (item !== "email" && !usernames[item])
                      }
                    >
                      {item[0].toUpperCase() + item.slice(1)}
                      {!isAvailable(item)
                        ? " — unavailable"
                        : item !== "email" && !isVerified(item)
                          ? " — not verified"
                          : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Email">
                <Input value={loaded.prefs.email} disabled />
              </Field>
              {usernameChannels.filter(isAvailable).map((item) => (
                <Field
                  key={item}
                  label={`${item[0].toUpperCase() + item.slice(1)} username`}
                  hint={isVerified(item) ? "Verified" : undefined}
                >
                  <Input
                    value={usernames[item]}
                    onChange={(event) =>
                      setUsernames({ ...usernames, [item]: event.target.value })
                    }
                  />
                </Field>
              ))}
              <Button className="justify-self-start" disabled={busy}>
                {busy ? "Saving" : "Save"}
              </Button>
            </form>
          </Card>
          {verifications.map((verify) => (
            <Card className="p-5" key={verify.channel}>
              <h2 className="font-mono font-semibold text-ctp-text">
                Verify {verify.channel}
              </h2>
              {hasBotVerification(verify.channel) ? (
                <div className="mt-4">
                  <ChannelVerificationPrompt
                    channel={verify.channel}
                    handle={session.handle}
                    server={loaded.server}
                  />
                </div>
              ) : (
                <form
                  className="mt-4 grid max-w-md gap-4"
                  onSubmit={confirmVerification}
                >
                  <input type="hidden" name="channel" value={verify.channel} />
                  <p className="text-sm text-ctp-subtext0">
                    Enter the code sent to {verify.identifier}.
                  </p>
                  <Field label="Verification code">
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={verify.code}
                      onChange={(event) =>
                        setVerifications((current) =>
                          current.map((item) =>
                            item.channel === verify.channel
                              ? { ...item, code: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button disabled={busy || !verify.code.trim()}>
                      Verify
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setVerifications((current) =>
                          current.filter(
                            (item) => item.channel !== verify.channel,
                          ),
                        )
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          ))}
          <section className="grid gap-3">
            <h2 className="font-mono text-sm font-semibold text-ctp-lavender">
              Message history
            </h2>
            {loaded.history.length === 0 ? (
              <EmptyState>No messages have been sent.</EmptyState>
            ) : (
              <Card className="divide-y divide-ctp-surface0">
                {loaded.history.map((item) => (
                  <article
                    key={`${item.createdAt}-${item.channel}-${item.notificationType}-${item.subject ?? ""}`}
                    className="p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-medium text-ctp-text">
                        {item.subject || item.notificationType}
                      </h3>
                      <time className="text-xs text-ctp-overlay1">
                        {formatDateTime(item.createdAt)}
                      </time>
                    </div>
                    <p className="mt-1 text-xs tracking-wide text-ctp-overlay1 uppercase">
                      {item.channel} · {item.status}
                    </p>
                    <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-ctp-subtext0">
                      {item.body}
                    </p>
                  </article>
                ))}
              </Card>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
