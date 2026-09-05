import { useEffect, useRef } from "react";
import type {
  ServerDescription,
  VerificationChannel,
} from "../lib/types/api.ts";
import { useTranslation } from "../lib/i18n.ts";

export type ChannelVerificationServer = Pick<
  ServerDescription,
  "discordAppId" | "discordBotUsername" | "telegramBotUsername"
>;

interface ChannelVerificationPromptProps {
  channel: VerificationChannel;
  handle: string;
  server: ChannelVerificationServer;
}

export function hasBotVerification(channel: VerificationChannel): boolean {
  return channel === "telegram" || channel === "discord";
}

export function useBotVerificationPolling(
  enabled: boolean,
  checkVerification: () => Promise<boolean>,
  onVerified?: () => void | Promise<void>,
) {
  const checkVerificationRef = useRef(checkVerification);
  const onVerifiedRef = useRef(onVerified);

  useEffect(() => {
    checkVerificationRef.current = checkVerification;
    onVerifiedRef.current = onVerified;
  }, [checkVerification, onVerified]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let checking = false;
    const interval = globalThis.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const verified = await checkVerificationRef.current();
        if (!active || !verified) return;
        await onVerifiedRef.current?.();
        globalThis.clearInterval(interval);
      } catch {
        // Bot verification is asynchronous. A failed check should not stop later checks.
      } finally {
        checking = false;
      }
    }, 3000);

    return () => {
      active = false;
      globalThis.clearInterval(interval);
    };
  }, [enabled]);
}

export function ChannelVerificationPrompt({
  channel,
  handle,
  server,
}: ChannelVerificationPromptProps) {
  const t = useTranslation();

  if (channel === "telegram") {
    const encodedHandle = handle.replaceAll(".", "_");
    return (
      <div className="grid gap-2 text-sm leading-6 text-ctp-subtext0">
        {server.telegramBotUsername ? (
          <a
            href={`https://t.me/${server.telegramBotUsername}?start=${encodedHandle}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("comms.telegramOpenLink")}
          </a>
        ) : null}
        <p>
          {server.telegramBotUsername
            ? t("comms.telegramStartBot", {
                handle,
                botUsername: server.telegramBotUsername,
              })
            : t("comms.telegramStartConfiguredBot", { handle })}
        </p>
        <p className="text-ctp-overlay1">{t("comms.verificationPending")}</p>
      </div>
    );
  }

  if (channel === "discord") {
    return (
      <div className="grid gap-2 text-sm leading-6 text-ctp-subtext0">
        {server.discordAppId ? (
          <a
            href={`https://discord.com/users/${server.discordAppId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("comms.discordOpenLink")}
          </a>
        ) : null}
        <p>
          {server.discordBotUsername
            ? t("comms.discordStartBot", {
                handle,
                botUsername: server.discordBotUsername,
              })
            : t("comms.discordStartConfiguredBot", { handle })}
        </p>
        <p className="text-ctp-overlay1">{t("comms.verificationPending")}</p>
      </div>
    );
  }

  return null;
}
