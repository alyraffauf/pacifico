export interface MessagingUsernames {
  discord: string;
  telegram: string;
  signal: string;
}

export interface ChangedMessagingUsernames {
  discordUsername?: string;
  telegramUsername?: string;
  signalUsername?: string;
}

export function getChangedMessagingUsernames(
  current: MessagingUsernames,
  saved: MessagingUsernames,
): ChangedMessagingUsernames {
  const changed: ChangedMessagingUsernames = {};
  if (current.discord !== saved.discord) changed.discordUsername = current.discord;
  if (current.telegram !== saved.telegram) changed.telegramUsername = current.telegram;
  if (current.signal !== saved.signal) changed.signalUsername = current.signal;
  return changed;
}
