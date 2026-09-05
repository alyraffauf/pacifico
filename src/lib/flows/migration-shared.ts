import type {
  MigrationProgress,
  ServerDescription,
  VerificationChannel,
} from "../migration/types.ts";
import type { AtprotoClient } from "../migration/atproto-client.ts";

export function createInitialProgress(): MigrationProgress {
  return {
    repoExported: false,
    repoImported: false,
    blobsTotal: 0,
    blobsMigrated: 0,
    blobsFailed: [],
    prefsMigrated: false,
    plcSigned: false,
    activated: false,
    deactivated: false,
    currentOperation: "",
  };
}

export async function checkHandleAvailabilityViaClient(
  client: AtprotoClient,
  handle: string,
): Promise<boolean> {
  try {
    await client.resolveHandle(handle);
    return false;
  } catch {
    return true;
  }
}

export function resolveVerificationIdentifier(
  channel: VerificationChannel,
  email: string,
  discordUsername: string,
  telegramUsername: string,
  signalUsername: string,
): string {
  switch (channel) {
    case "email": return email;
    case "discord": return discordUsername;
    case "telegram": return telegramUsername;
    case "signal": return signalUsername;
  }
}

export async function loadServerInfo(
  client: AtprotoClient,
  cached: ServerDescription | null,
): Promise<ServerDescription> {
  if (cached) return cached;
  return client.describeServer();
}
