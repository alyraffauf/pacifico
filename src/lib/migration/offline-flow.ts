import type {
  AuthMethod,
  MigrationProgress,
  OfflineInboundMigrationState,
  OfflineInboundStep,
  ServerDescription,
} from "./types.ts";
import {
  AtprotoClient,
  createLocalClient,
} from "./atproto-client.ts";
import { createPasskeyCredential } from "../flows/perform-passkey-registration.ts";
import { api } from "../api.ts";
import { type KeypairInfo, plcOps, type PrivateKey } from "./plc-ops.ts";
import { migrateBlobs as migrateBlobsUtil } from "./blob-migration.ts";
import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
} from "../types/branded.ts";

const OFFLINE_STORAGE_KEY = "tranquil_offline_migration_state";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredOfflineMigrationState {
  version: number;
  step: OfflineInboundStep;
  startedAt: string;
  userDid: string;
  carFileName: string;
  carSizeBytes: number;
  rotationKeyDidKey: string;
  targetHandle: string;
  targetEmail: string;
  authMethod: AuthMethod;
  passkeySetupToken?: string;
  oldPdsUrl?: string;
  plcUpdatedTemporarily?: boolean;
  progress: {
    accountCreated: boolean;
    repoImported: boolean;
    plcSigned: boolean;
    activated: boolean;
  };
  lastError?: string;
}

function saveOfflineState(state: OfflineInboundMigrationState): void {
  const stored: StoredOfflineMigrationState = {
    version: 1,
    step: state.step,
    startedAt: new Date().toISOString(),
    userDid: state.userDid,
    carFileName: state.carFileName,
    carSizeBytes: state.carSizeBytes,
    rotationKeyDidKey: state.rotationKeyDidKey,
    targetHandle: state.targetHandle,
    targetEmail: state.targetEmail,
    authMethod: state.authMethod,
    passkeySetupToken: state.passkeySetupToken ?? undefined,
    oldPdsUrl: state.oldPdsUrl ?? undefined,
    plcUpdatedTemporarily: state.plcUpdatedTemporarily || undefined,
    progress: {
      accountCreated: state.progress.repoExported,
      repoImported: state.progress.repoImported,
      plcSigned: state.progress.plcSigned,
      activated: state.progress.activated,
    },
    lastError: state.error ?? undefined,
  };
  try {
    localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(stored));
  } catch { /* ignore localStorage errors */ }
}

function loadOfflineState(): StoredOfflineMigrationState | null {
  try {
    const stored = localStorage.getItem(OFFLINE_STORAGE_KEY);
    if (!stored) return null;
    const state = JSON.parse(stored) as StoredOfflineMigrationState;
    if (state.version !== 1) {
      clearOfflineState();
      return null;
    }
    const startedAt = new Date(state.startedAt).getTime();
    if (Date.now() - startedAt > MAX_AGE_MS) {
      clearOfflineState();
      return null;
    }
    return state;
  } catch {
    /* ignore parse errors */
    clearOfflineState();
    return null;
  }
}

function clearOfflineState(): void {
  try {
    localStorage.removeItem(OFFLINE_STORAGE_KEY);
  } catch { /* ignore localStorage errors */ }
}

export function hasPendingOfflineMigration(): boolean {
  return loadOfflineState() !== null;
}

export function getOfflineResumeInfo(): {
  step: OfflineInboundStep;
  userDid: string;
  targetHandle: string;
} | null {
  const state = loadOfflineState();
  if (!state) return null;
  return {
    step: state.step,
    userDid: state.userDid,
    targetHandle: state.targetHandle,
  };
}

export { clearOfflineState };

import {
  createInitialProgress,
  checkHandleAvailabilityViaClient,
  loadServerInfo,
  resolveVerificationIdentifier,
} from "../flows/migration-shared.ts";
import { createEmailVerificationPoller } from "../flows/email-verification.ts";

export type OfflineInboundMigrationFlow = ReturnType<
  typeof createOfflineInboundMigrationFlow
>;

export function createOfflineInboundMigrationFlow() {
  let state: OfflineInboundMigrationState = {
    direction: "offline-inbound",
    step: "welcome",
    userDid: "",
    carFile: null,
    carFileName: "",
    carSizeBytes: 0,
    carNeedsReupload: false,
    rotationKey: "",
    rotationKeyDidKey: "",
    oldPdsUrl: null,
    targetHandle: "",
    targetEmail: "",
    targetPassword: "",
    inviteCode: "",
    authMethod: "password",
    localAccessToken: null,
    localRefreshToken: null,
    passkeySetupToken: null,
    generatedAppPassword: null,
    generatedAppPasswordName: null,
    emailVerifyToken: "",
    progress: createInitialProgress(),
    error: null,
    plcUpdatedTemporarily: false,
    handlePreservation: "new",
    existingHandleVerified: false,
    verificationChannel: "email",
    discordUsername: "",
    telegramUsername: "",
    signalUsername: "",
  };

  let localServerInfo: ServerDescription | null = null;
  let userRotationKeypair: KeypairInfo | null = null;
  let tempVerificationKeypair: Secp256k1PrivateKeyExportable | null = null;

  function setStep(step: OfflineInboundStep) {
    state.step = step;
    if (step !== "error") {
      state.error = null;
    }
    if (step !== "success") {
      saveOfflineState(state);
    }
  }

  function setError(error: string | null) {
    state.error = error;
    saveOfflineState(state);
  }

  function setProgress(updates: Partial<MigrationProgress>) {
    state.progress = { ...state.progress, ...updates };
    saveOfflineState(state);
  }

  async function loadLocalServerInfo(): Promise<ServerDescription> {
    const info = await loadServerInfo(createLocalClient(), localServerInfo);
    localServerInfo = info;
    return info;
  }

  async function checkHandleAvailability(handle: string): Promise<boolean> {
    return checkHandleAvailabilityViaClient(createLocalClient(), handle);
  }

  async function validateRotationKey(): Promise<boolean> {
    if (!state.userDid || !state.rotationKey) {
      throw new Error("DID and rotation key are required");
    }

    try {
      const { lastOperation } = await plcOps.getLastPlcOpFromPlc(state.userDid);
      const currentRotationKeys = lastOperation.rotationKeys || [];

      userRotationKeypair = await plcOps.getMatchingKeyPair(
        state.rotationKey.trim(),
        currentRotationKeys,
      );

      if (!userRotationKeypair) {
        state.rotationKeyDidKey = "";
        return false;
      }

      state.rotationKeyDidKey = userRotationKeypair.didPublicKey;

      const pdsService = lastOperation.services?.atproto_pds;
      if (pdsService?.endpoint) {
        state.oldPdsUrl = pdsService.endpoint;
      }

      saveOfflineState(state);
      return true;
    } catch (e) {
      throw new Error(`Failed to parse rotation key: ${(e as Error).message}`);
    }
  }

  async function prepareTempCredentials(): Promise<string> {
    if (!userRotationKeypair) {
      throw new Error("Rotation key not validated");
    }

    setProgress({ currentOperation: "Preparing temporary credentials..." });

    tempVerificationKeypair = await Secp256k1PrivateKeyExportable
      .createKeypair();
    const tempVerificationPublicKey = await tempVerificationKeypair
      .exportPublicKey("did");

    const { lastOperation, base } = await plcOps.getLastPlcOpFromPlc(
      state.userDid,
    );
    const prevCid = base.cid;

    setProgress({ currentOperation: "Updating DID document temporarily..." });

    const localPdsUrl = globalThis.location.origin;
    await plcOps.signAndPublishNewOp(
      state.userDid,
      userRotationKeypair.keypair,
      lastOperation.alsoKnownAs || [],
      [userRotationKeypair.didPublicKey],
      localPdsUrl,
      tempVerificationPublicKey,
      prevCid,
    );

    state.plcUpdatedTemporarily = true;
    saveOfflineState(state);

    const serverInfo = await loadLocalServerInfo();
    const serviceAuthToken = await plcOps.createServiceAuthToken(
      state.userDid,
      serverInfo.did,
      tempVerificationKeypair as unknown as PrivateKey,
      "com.atproto.server.createAccount",
    );

    return serviceAuthToken;
  }

  async function createPasswordAccount(
    serviceAuthToken: string,
  ): Promise<void> {
    setProgress({ currentOperation: "Creating account on new PDS..." });

    const serverInfo = await loadLocalServerInfo();
    const fullHandle = state.targetHandle.includes(".")
      ? state.targetHandle
      : `${state.targetHandle}.${serverInfo.availableUserDomains[0]}`;

    const createResult = await api.createAccountWithServiceAuth(
      serviceAuthToken,
      {
        did: unsafeAsDid(state.userDid),
        handle: unsafeAsHandle(fullHandle),
        email: state.targetEmail ? unsafeAsEmail(state.targetEmail) : undefined,
        password: state.targetPassword,
        inviteCode: state.inviteCode || undefined,
        verificationChannel: state.verificationChannel,
        discordUsername: state.discordUsername || undefined,
        telegramUsername: state.telegramUsername || undefined,
        signalUsername: state.signalUsername || undefined,
      },
    );

    state.targetHandle = fullHandle;
    state.localAccessToken = createResult.accessJwt;
    state.localRefreshToken = createResult.refreshJwt;
    setProgress({ repoExported: true });
  }

  async function createPasskeyAccount(serviceAuthToken: string): Promise<void> {
    setProgress({ currentOperation: "Creating passkey account on new PDS..." });

    const serverInfo = await loadLocalServerInfo();
    const fullHandle = state.targetHandle.includes(".")
      ? state.targetHandle
      : `${state.targetHandle}.${serverInfo.availableUserDomains[0]}`;

    const createResult = await api.createPasskeyAccount({
      did: unsafeAsDid(state.userDid),
      handle: unsafeAsHandle(fullHandle),
      email: state.targetEmail ? unsafeAsEmail(state.targetEmail) : undefined,
      inviteCode: state.inviteCode || undefined,
      verificationChannel: state.verificationChannel,
      discordUsername: state.discordUsername || undefined,
      telegramUsername: state.telegramUsername || undefined,
      signalUsername: state.signalUsername || undefined,
    }, serviceAuthToken);

    state.targetHandle = fullHandle;
    state.passkeySetupToken = createResult.setupToken;
    setProgress({ repoExported: true });
    saveOfflineState(state);
  }

  async function signFinalPlcOperation(): Promise<void> {
    if (!userRotationKeypair || !state.localAccessToken) {
      throw new Error("Prerequisites not met for PLC signing");
    }

    setProgress({ currentOperation: "Finalizing DID document..." });

    const { base } = await plcOps.getLastPlcOpFromPlc(state.userDid);
    const prevCid = base.cid;

    const credentials = await api.getRecommendedDidCredentials(
      unsafeAsAccessToken(state.localAccessToken),
    );

    await plcOps.signPlcOperationWithCredentials(
      state.userDid,
      userRotationKeypair.keypair,
      {
        rotationKeys: credentials.rotationKeys,
        alsoKnownAs: credentials.alsoKnownAs,
        verificationMethods: credentials.verificationMethods,
        services: credentials.services,
      },
      [userRotationKeypair.didPublicKey],
      prevCid,
    );

    setProgress({ plcSigned: true });
  }

  async function importRepository(): Promise<void> {
    if (!state.carFile || !state.localAccessToken) {
      throw new Error("CAR file and access token are required");
    }

    setProgress({ currentOperation: "Importing repository..." });
    await api.importRepo(
      unsafeAsAccessToken(state.localAccessToken),
      state.carFile,
    );
    setProgress({ repoImported: true });
  }

  async function migrateBlobs(): Promise<void> {
    if (!state.localAccessToken) {
      throw new Error("Access token required");
    }

    const localClient = createLocalClient();
    localClient.setAccessToken(unsafeAsAccessToken(state.localAccessToken));

    if (state.oldPdsUrl) {
      setProgress({
        currentOperation: `Will fetch blobs from ${state.oldPdsUrl}`,
      });
    } else {
      setProgress({
        currentOperation: "No source PDS URL available for blob migration",
      });
    }

    const sourceClient = state.oldPdsUrl
      ? new AtprotoClient(state.oldPdsUrl)
      : null;

    const result = await migrateBlobsUtil(
      localClient,
      sourceClient,
      state.userDid,
      setProgress,
    );

    state.progress.blobsFailed = result.failed;
    state.progress.blobsTotal = result.total;
    state.progress.blobsMigrated = result.migrated;

    if (result.total === 0) {
      setProgress({ currentOperation: "No blobs to migrate" });
    } else if (result.sourceUnreachable) {
      setProgress({
        currentOperation:
          `Source PDS unreachable. ${result.failed.length} blobs could not be migrated.`,
      });
    } else if (result.failed.length > 0) {
      setProgress({
        currentOperation:
          `${result.migrated}/${result.total} blobs migrated. ${result.failed.length} failed.`,
      });
    } else {
      setProgress({
        currentOperation: `All ${result.migrated} blobs migrated successfully`,
      });
    }
  }

  async function activateAccount(): Promise<void> {
    if (!state.localAccessToken) {
      throw new Error("Access token required");
    }

    setProgress({ currentOperation: "Activating account..." });
    await api.activateAccount(unsafeAsAccessToken(state.localAccessToken));
    setProgress({ activated: true });
  }

  async function submitEmailVerifyToken(token: string): Promise<void> {
    state.emailVerifyToken = token;
    setError(null);

    try {
      await api.verifyMigrationEmail(token, unsafeAsEmail(state.targetEmail));

      if (state.authMethod === "passkey") {
        setStep("passkey-setup");
      } else {
        const session = await api.createSession(
          state.targetEmail,
          state.targetPassword,
        );
        state.localAccessToken = session.accessJwt;
        state.localRefreshToken = session.refreshJwt;
        saveOfflineState(state);

        setStep("plc-signing");
        await signFinalPlcOperation();

        setStep("finalizing");
        await activateAccount();

        cleanup();
        setStep("success");
      }
    } catch (e) {
      const err = e as Error & { error?: string };
      setError(err.message || err.error || "Email verification failed");
    }
  }

  async function resendEmailVerification(): Promise<void> {
    await api.resendMigrationVerification(
      state.verificationChannel,
      resolveVerificationIdentifier(
        state.verificationChannel,
        state.targetEmail,
        state.discordUsername,
        state.telegramUsername,
        state.signalUsername,
      ),
    );
  }

  const verificationPoller = createEmailVerificationPoller({
    async checkVerified() {
      if (state.authMethod === "passkey") return false;
      if (state.verificationChannel === "email") {
        const { verified } = await api.checkEmailVerified(state.targetEmail);
        return verified;
      }
      const { verified } = await api.checkChannelVerified(
        state.userDid,
        state.verificationChannel,
      );
      return verified;
    },
    async onVerified() {
      if (!state.localAccessToken) {
        const session = await api.createSession(
          state.targetEmail,
          state.targetPassword,
        );
        state.localAccessToken = session.accessJwt;
        state.localRefreshToken = session.refreshJwt;
      }
      saveOfflineState(state);

      setStep("plc-signing");
      await signFinalPlcOperation();

      setStep("finalizing");
      await activateAccount();

      cleanup();
      setStep("success");
    },
  });

  function checkEmailVerifiedAndProceed(): Promise<boolean> {
    return verificationPoller.checkAndAdvance();
  }

  async function startPasskeyRegistration(): Promise<{ options: unknown }> {
    if (!state.passkeySetupToken) {
      throw new Error("No passkey setup token");
    }

    return api.startPasskeyRegistrationForSetup(
      unsafeAsDid(state.userDid),
      state.passkeySetupToken,
    );
  }

  async function registerPasskey(passkeyName?: string): Promise<void> {
    if (!state.passkeySetupToken) {
      throw new Error("No passkey setup token");
    }

    const credential = await createPasskeyCredential(
      () => startPasskeyRegistration(),
    );

    const result = await api.completePasskeySetup(
      unsafeAsDid(state.userDid),
      state.passkeySetupToken,
      credential,
      passkeyName,
    );

    state.generatedAppPassword = result.appPassword;
    state.generatedAppPasswordName = result.appPasswordName;

    const session = await api.createSession(
      state.targetEmail,
      result.appPassword,
    );
    state.localAccessToken = session.accessJwt;
    state.localRefreshToken = session.refreshJwt;
    saveOfflineState(state);

    setStep("app-password");
  }

  async function proceedFromAppPassword(): Promise<void> {
    setStep("plc-signing");
    await signFinalPlcOperation();

    setStep("finalizing");
    await activateAccount();

    cleanup();
    setStep("success");
  }

  function cleanup(): void {
    clearOfflineState();
    userRotationKeypair = null;
    tempVerificationKeypair = null;
    state.rotationKey = "";
  }

  async function runMigration(): Promise<void> {
    try {
      setStep("creating");

      const serviceAuthToken = await prepareTempCredentials();

      if (state.authMethod === "passkey") {
        await createPasskeyAccount(serviceAuthToken);
      } else {
        await createPasswordAccount(serviceAuthToken);
      }

      setStep("importing");
      await importRepository();

      setStep("migrating-blobs");
      await migrateBlobs();

      if (
        state.progress.blobsTotal > 0 || state.progress.blobsFailed.length > 0
      ) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      setStep("email-verify");
    } catch (e) {
      setError((e as Error).message);
      setStep("error");
    }
  }

  function reset() {
    clearOfflineState();
    userRotationKeypair = null;
    tempVerificationKeypair = null;
    state = {
      direction: "offline-inbound",
      step: "welcome",
      userDid: "",
      carFile: null,
      carFileName: "",
      carSizeBytes: 0,
      carNeedsReupload: false,
      rotationKey: "",
      rotationKeyDidKey: "",
      oldPdsUrl: null,
      targetHandle: "",
      targetEmail: "",
      targetPassword: "",
      inviteCode: "",
      authMethod: "password",
      localAccessToken: null,
      localRefreshToken: null,
      passkeySetupToken: null,
      generatedAppPassword: null,
      generatedAppPasswordName: null,
      emailVerifyToken: "",
      progress: createInitialProgress(),
      error: null,
      plcUpdatedTemporarily: false,
      handlePreservation: "new",
      existingHandleVerified: false,
      verificationChannel: "email",
      discordUsername: "",
      telegramUsername: "",
      signalUsername: "",
    };
    localServerInfo = null;
  }

  function tryResume(): boolean {
    const stored = loadOfflineState();
    if (!stored) return false;

    state.userDid = stored.userDid;
    state.carFileName = stored.carFileName;
    state.carSizeBytes = stored.carSizeBytes;
    state.rotationKeyDidKey = stored.rotationKeyDidKey;
    state.targetHandle = stored.targetHandle;
    state.targetEmail = stored.targetEmail;
    state.authMethod = stored.authMethod ?? "password";
    state.passkeySetupToken = stored.passkeySetupToken ?? null;
    state.oldPdsUrl = stored.oldPdsUrl ?? null;
    state.plcUpdatedTemporarily = stored.plcUpdatedTemporarily ?? false;
    state.step = stored.step;
    state.progress.repoExported = stored.progress.accountCreated;
    state.progress.repoImported = stored.progress.repoImported;
    state.progress.plcSigned = stored.progress.plcSigned;
    state.progress.activated = stored.progress.activated;
    state.error = stored.lastError ?? null;

    if (stored.carFileName && stored.carSizeBytes > 0) {
      state.carNeedsReupload = true;
    }

    return true;
  }

  function getLocalSession():
    | { accessJwt: string; did: string; handle: string }
    | null {
    if (!state.localAccessToken) return null;
    return {
      accessJwt: state.localAccessToken,
      did: state.userDid,
      handle: state.targetHandle,
    };
  }

  return {
    get state() {
      return state;
    },
    getLocalSession,
    setStep,
    setError,
    setProgress,
    loadLocalServerInfo,
    checkHandleAvailability,
    validateRotationKey,
    runMigration,
    submitEmailVerifyToken,
    resendEmailVerification,
    checkEmailVerifiedAndProceed,
    startPasskeyRegistration,
    registerPasskey,
    proceedFromAppPassword,
    reset,
    tryResume,
    clearOfflineState,
    setUserDid(did: string) {
      state.userDid = did;
      saveOfflineState(state);
    },
    setCarFile(file: Uint8Array, fileName: string) {
      state.carFile = file;
      state.carFileName = fileName;
      state.carSizeBytes = file.length;
      state.carNeedsReupload = false;
      saveOfflineState(state);
    },
    setRotationKey(key: string) {
      state.rotationKey = key;
    },
    setTargetHandle(handle: string) {
      state.targetHandle = handle;
      saveOfflineState(state);
    },
    setTargetEmail(email: string) {
      state.targetEmail = email;
      saveOfflineState(state);
    },
    setTargetPassword(password: string) {
      state.targetPassword = password;
    },
    setInviteCode(code: string) {
      state.inviteCode = code;
    },
    setAuthMethod(method: AuthMethod) {
      state.authMethod = method;
      saveOfflineState(state);
    },
    updateField<K extends keyof OfflineInboundMigrationState>(
      field: K,
      value: OfflineInboundMigrationState[K],
    ) {
      state[field] = value;
      saveOfflineState(state);
    },
  };
}
