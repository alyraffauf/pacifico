import type {
  MigrationDirection,
  MigrationState,
  StoredMigrationState,
} from "./types.ts";
import { clearDPoPKey } from "./atproto-client.ts";

const STORAGE_KEY = "tranquil_migration_state";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function saveMigrationState(state: MigrationState): void {
  const storedState: StoredMigrationState = {
    version: 1,
    direction: state.direction,
    step: state.step,
    startedAt: new Date().toISOString(),
    sourcePdsUrl: state.sourcePdsUrl,
    targetPdsUrl: globalThis.location.origin,
    sourceDid: state.sourceDid,
    sourceHandle: state.sourceHandle,
    targetHandle: state.targetHandle,
    targetEmail: state.targetEmail,
    authMethod: state.authMethod,
    passkeySetupToken: state.passkeySetupToken ?? undefined,
    localAccessToken: state.localAccessToken ?? undefined,
    localRefreshToken: state.localRefreshToken ?? undefined,
    progress: {
      repoExported: state.progress.repoExported,
      repoImported: state.progress.repoImported,
      blobsTotal: state.progress.blobsTotal,
      blobsMigrated: state.progress.blobsMigrated,
      prefsMigrated: state.progress.prefsMigrated,
      plcSigned: state.progress.plcSigned,
    },
    lastError: state.error ?? undefined,
    lastErrorStep: state.error ? state.step : undefined,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState));
  } catch { /* localStorage unavailable */ }
}

export function loadMigrationState(): StoredMigrationState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const state = JSON.parse(stored) as StoredMigrationState;

    if (state.version !== 1) {
      clearMigrationState();
      return null;
    }

    const startedAt = new Date(state.startedAt).getTime();
    if (Date.now() - startedAt > MAX_AGE_MS) {
      clearMigrationState();
      return null;
    }

    return state;
  } catch {
    clearMigrationState();
    return null;
  }
}

export function clearMigrationState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    clearDPoPKey();
  } catch { /* localStorage unavailable */ }
}

export function hasPendingMigration(): boolean {
  return loadMigrationState() !== null;
}

export function getResumeInfo(): {
  direction: MigrationDirection;
  sourceHandle: string;
  targetHandle: string;
  sourcePdsUrl: string;
  targetPdsUrl: string;
  targetEmail: string;
  authMethod?: "password" | "passkey";
  progressSummary: string;
  step: string;
} | null {
  const state = loadMigrationState();
  if (!state) return null;

  const progressParts: string[] = [];
  if (state.progress.repoExported) progressParts.push("repo exported");
  if (state.progress.repoImported) progressParts.push("repo imported");
  if (state.progress.blobsMigrated > 0) {
    progressParts.push(
      `${state.progress.blobsMigrated}/${state.progress.blobsTotal} blobs`,
    );
  }
  if (state.progress.prefsMigrated) progressParts.push("preferences migrated");
  if (state.progress.plcSigned) progressParts.push("PLC signed");

  return {
    direction: state.direction,
    sourceHandle: state.sourceHandle,
    targetHandle: state.targetHandle,
    sourcePdsUrl: state.sourcePdsUrl,
    targetPdsUrl: state.targetPdsUrl,
    targetEmail: state.targetEmail,
    authMethod: state.authMethod,
    progressSummary: progressParts.length > 0
      ? progressParts.join(", ")
      : "just started",
    step: state.step,
  };
}

export function updateProgress(
  updates: Partial<StoredMigrationState["progress"]>,
): void {
  const state = loadMigrationState();
  if (!state) return;

  state.progress = { ...state.progress, ...updates };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* localStorage unavailable */ }
}

export function updateStep(step: string): void {
  const state = loadMigrationState();
  if (!state) return;

  state.step = step;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* localStorage unavailable */ }
}

export function setError(error: string, step: string): void {
  const state = loadMigrationState();
  if (!state) return;

  state.lastError = error;
  state.lastErrorStep = step;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* localStorage unavailable */ }
}
