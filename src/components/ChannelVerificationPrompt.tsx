import { useEffect, useRef } from "react";
import type { ServerDescription, VerificationChannel } from "../lib/types/api.ts";

export type ChannelVerificationServer = Pick<ServerDescription, "discordAppId" | "discordBotUsername" | "telegramBotUsername">;

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

export function ChannelVerificationPrompt({ channel, handle, server }: ChannelVerificationPromptProps) {
  if (channel === "telegram") {
    const encodedHandle = handle.replaceAll(".", "_");
    return (
      <div className="grid gap-2 text-sm leading-6 text-ctp-subtext-0">
        {server.telegramBotUsername ? (
          <a
            href={`https://t.me/${server.telegramBotUsername}?start=${encodedHandle}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Telegram to verify
          </a>
        ) : null}
        <p>
          Send <code>/start {handle}</code> to {server.telegramBotUsername ? <code>@{server.telegramBotUsername}</code> : "the configured Telegram bot"}.
        </p>
        <p className="text-ctp-overlay-1">Waiting for verification...</p>
      </div>
    );
  }

  if (channel === "discord") {
    return (
      <div className="grid gap-2 text-sm leading-6 text-ctp-subtext-0">
        {server.discordAppId ? (
          <a
            href={`https://discord.com/users/${server.discordAppId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Discord to verify
          </a>
        ) : null}
        <p>
          Or send <code>/start {handle}</code> to <strong>{server.discordBotUsername ?? "the bot"}</strong>.
        </p>
        <p className="text-ctp-overlay-1">Waiting for verification...</p>
      </div>
    );
  }

  return null;
}
