import type {
  InboundMigrationState,
  InboundStep,
  MigrationProgress,
  PasskeyAccountSetup,
  ServerDescription,
  StoredMigrationState,
} from "./types.ts";
import {
  AtprotoClient,
  clearDPoPKey,
  createLocalClient,
  exchangeOAuthCode,
  generateDPoPKeyPair,
  getMigrationOAuthClientId,
  getMigrationOAuthRedirectUri,
  getOAuthServerMetadata,
  initiateOAuthWithPAR,
  loadDPoPKey,
  resolvePdsUrl,
  saveDPoPKey,
} from "./atproto-client.ts";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "../oauth.ts";
import {
  clearMigrationState,
  saveMigrationState,
  updateProgress,
  updateStep,
} from "./storage.ts";
import { migrateBlobs as migrateBlobsUtil } from "./blob-migration.ts";

function migrationLog(stage: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const msg = `[MIGRATION ${timestamp}] ${stage}`;
  if (data) {
    console.log(msg, JSON.stringify(data, null, 2));
  } else {
    console.log(msg);
  }
}

import {
  createInitialProgress,
  checkHandleAvailabilityViaClient,
  loadServerInfo,
  resolveVerificationIdentifier,
} from "../flows/migration-shared.ts";
import { createEmailVerificationPoller } from "../flows/email-verification.ts";

export function createInboundMigrationFlow() {
  let state: InboundMigrationState = {
    direction: "inbound",
    step: "welcome",
    sourcePdsUrl: "",
    sourceDid: "",
    sourceHandle: "",
    targetHandle: "",
    targetEmail: "",
    targetPassword: "",
    inviteCode: "",
    sourceAccessToken: null,
    sourceRefreshToken: null,
    serviceAuthToken: null,
    emailVerifyToken: "",
    plcToken: "",
    progress: createInitialProgress(),
    error: null,
    targetVerificationMethod: null,
    authMethod: "password",
    passkeySetupToken: null,
    oauthCodeVerifier: null,
    localAccessToken: null,
    localRefreshToken: null,
    generatedAppPassword: null,
    generatedAppPasswordName: null,
    handlePreservation: "new",
    existingHandleVerified: false,
    verificationChannel: "email",
    discordUsername: "",
    telegramUsername: "",
    signalUsername: "",
  };

  let sourceClient: AtprotoClient | null = null;
  let localClient: AtprotoClient | null = null;
  let localServerInfo: ServerDescription | null = null;
  let sourcePdsDomains: string[] = [];

  function setStep(step: InboundStep) {
    state.step = step;
    if (step !== "error") {
      state.error = null;
    }
    if (step !== "success") {
      saveMigrationState(state);
      updateStep(step);
    }
  }

  function setError(error: string | null) {
    state.error = error;
    saveMigrationState(state);
  }

  function setProgress(updates: Partial<MigrationProgress>) {
    state.progress = { ...state.progress, ...updates };
    updateProgress(updates);
  }

  async function loadLocalServerInfo(): Promise<ServerDescription> {
    if (!localClient) {
      localClient = createLocalClient();
    }
    const info = await loadServerInfo(localClient, localServerInfo);
    localServerInfo = info;
    return info;
  }

  async function resolveSourcePds(handle: string): Promise<void> {
    const normalized = handle.startsWith("@") ? handle.slice(1) : handle;
    try {
      const { did, pdsUrl } = await resolvePdsUrl(normalized);
      state.sourcePdsUrl = pdsUrl;
      state.sourceDid = did;
      state.sourceHandle = normalized;
      sourceClient = new AtprotoClient(pdsUrl);
    } catch (e) {
      throw new Error(`Could not resolve handle: ${(e as Error).message}`);
    }
  }

  async function initiateOAuthLogin(handle: string): Promise<void> {
    migrationLog("initiateOAuthLogin START", { handle });

    const normalizedHandle = handle.startsWith("@") ? handle.slice(1) : handle;
    if (!state.sourcePdsUrl || state.sourceHandle !== normalizedHandle) {
      await resolveSourcePds(normalizedHandle);
    }

    const metadata = await getOAuthServerMetadata(state.sourcePdsUrl);
    if (!metadata) {
      throw new Error(
        "Source PDS does not support OAuth. This PDS only supports OAuth-based migrations.",
      );
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const oauthState = generateState();

    const dpopKeyPair = await generateDPoPKeyPair();
    await saveDPoPKey(dpopKeyPair);

    localStorage.setItem("migration_oauth_state", oauthState);
    localStorage.setItem("migration_oauth_code_verifier", codeVerifier);
    localStorage.setItem("migration_source_pds_url", state.sourcePdsUrl);
    localStorage.setItem("migration_source_did", state.sourceDid);
    localStorage.setItem("migration_source_handle", state.sourceHandle);
    localStorage.setItem("migration_oauth_issuer", metadata.issuer);
    if (state.resumeToStep) {
      localStorage.setItem("migration_resume_to_step", state.resumeToStep);
    }

    const authUrl = await initiateOAuthWithPAR(metadata, {
      clientId: getMigrationOAuthClientId(),
      redirectUri: getMigrationOAuthRedirectUri(),
      codeChallenge,
      state: oauthState,
      scope:
        "atproto identity:* account:repo?action=manage rpc:com.atproto.server.createAccount?aud=*",
      dpopJkt: dpopKeyPair.thumbprint,
      loginHint: state.sourceHandle,
    });

    migrationLog("initiateOAuthLogin: Redirecting to authorization", {
      sourcePdsUrl: state.sourcePdsUrl,
      authEndpoint: metadata.authorization_endpoint,
      dpopJkt: dpopKeyPair.thumbprint,
    });

    state.oauthCodeVerifier = codeVerifier;
    saveMigrationState(state);

    globalThis.location.href = authUrl;
  }

  function cleanupOAuthSessionData(): void {
    localStorage.removeItem("migration_oauth_state");
    localStorage.removeItem("migration_oauth_code_verifier");
    localStorage.removeItem("migration_source_pds_url");
    localStorage.removeItem("migration_source_did");
    localStorage.removeItem("migration_source_handle");
    localStorage.removeItem("migration_oauth_issuer");
    localStorage.removeItem("migration_resume_to_step");
  }

  async function handleOAuthCallback(
    code: string,
    returnedState: string,
  ): Promise<void> {
    migrationLog("handleOAuthCallback START");

    const savedState = localStorage.getItem("migration_oauth_state");
    const codeVerifier = localStorage.getItem("migration_oauth_code_verifier");
    const sourcePdsUrl = localStorage.getItem("migration_source_pds_url");
    const sourceDid = localStorage.getItem("migration_source_did");
    const sourceHandle = localStorage.getItem("migration_source_handle");
    const oauthIssuer = localStorage.getItem("migration_oauth_issuer");
    const savedResumeToStep = localStorage.getItem("migration_resume_to_step");

    if (savedResumeToStep) {
      state.needsReauth = true;
      state.resumeToStep = savedResumeToStep as InboundMigrationState["step"];
    }

    if (returnedState !== savedState) {
      cleanupOAuthSessionData();
      throw new Error("OAuth state mismatch - possible CSRF attack");
    }

    if (!codeVerifier || !sourcePdsUrl || !sourceDid || !sourceHandle) {
      cleanupOAuthSessionData();
      throw new Error("Missing OAuth session data");
    }

    const dpopKeyPair = await loadDPoPKey();
    if (!dpopKeyPair) {
      cleanupOAuthSessionData();
      throw new Error("Missing DPoP key - please restart the migration");
    }

    state.sourcePdsUrl = sourcePdsUrl;
    state.sourceDid = sourceDid;
    state.sourceHandle = sourceHandle;
    sourceClient = new AtprotoClient(sourcePdsUrl);

    let metadata = await getOAuthServerMetadata(sourcePdsUrl);
    if (!metadata && oauthIssuer) {
      metadata = await getOAuthServerMetadata(oauthIssuer);
    }
    if (!metadata) {
      cleanupOAuthSessionData();
      throw new Error("Could not fetch OAuth server metadata");
    }

    migrationLog("handleOAuthCallback: Exchanging code for tokens");

    let tokenResponse;
    try {
      tokenResponse = await exchangeOAuthCode(metadata, {
        code,
        codeVerifier,
        clientId: getMigrationOAuthClientId(),
        redirectUri: getMigrationOAuthRedirectUri(),
        dpopKeyPair,
      });
    } catch (err) {
      cleanupOAuthSessionData();
      throw err;
    }

    migrationLog("handleOAuthCallback: Got access token");

    state.sourceAccessToken = tokenResponse.access_token;
    state.sourceRefreshToken = tokenResponse.refresh_token ?? null;
    sourceClient.setAccessToken(tokenResponse.access_token);
    sourceClient.setRefreshToken(tokenResponse.refresh_token ?? null);
    sourceClient.setDPoPKeyPair(dpopKeyPair);
    sourceClient.setOAuthRefreshContext(
      metadata.token_endpoint,
      getMigrationOAuthClientId(),
    );

    cleanupOAuthSessionData();

    if (state.needsReauth && state.resumeToStep) {
      const targetStep = state.resumeToStep;
      state.needsReauth = false;
      state.resumeToStep = undefined;

      const postEmailSteps = [
        "plc-token",
        "did-web-update",
        "finalizing",
        "app-password",
      ];

      if (postEmailSteps.includes(targetStep)) {
        localClient = createLocalClient();
        if (state.localAccessToken) {
          localClient.setAccessToken(state.localAccessToken);
        }
        if (state.localRefreshToken) {
          localClient.setRefreshToken(state.localRefreshToken);
        }
        if (state.authMethod === "passkey" && state.passkeySetupToken) {
          setStep("passkey-setup");
          migrationLog(
            "handleOAuthCallback: Resuming passkey flow at passkey-setup",
          );
        } else {
          const alreadyVerified = await localClient
            .checkChannelVerified(state.sourceDid, state.verificationChannel)
            .catch(() => false);
          if (alreadyVerified) {
            migrationLog(
              "handleOAuthCallback: Already verified, skipping email-verify",
            );
            await proceedAfterVerification();
          } else {
            setStep("email-verify");
            migrationLog(
              "handleOAuthCallback: Resuming at email-verify for re-auth",
            );
          }
        }
      } else if (targetStep === "email-verify") {
        localClient = createLocalClient();
        if (state.localAccessToken) {
          localClient.setAccessToken(state.localAccessToken);
        }
        if (state.localRefreshToken) {
          localClient.setRefreshToken(state.localRefreshToken);
        }
        setStep("email-verify");
        migrationLog("handleOAuthCallback: Resuming at email-verify");
      } else {
        setStep(targetStep);
      }
    } else {
      setStep("choose-handle");
    }
    saveMigrationState(state);
  }

  async function loadSourcePdsDomains(): Promise<string[]> {
    if (sourcePdsDomains.length > 0) return sourcePdsDomains;
    if (!sourceClient) return [];
    try {
      const info = await sourceClient.describeServer();
      sourcePdsDomains = info.availableUserDomains;
    } catch {
      sourcePdsDomains = [];
    }
    return sourcePdsDomains;
  }

  async function checkHandleAvailability(handle: string): Promise<boolean> {
    if (!localClient) {
      localClient = createLocalClient();
    }
    return checkHandleAvailabilityViaClient(localClient, handle);
  }

  async function verifyExistingHandle(): Promise<{
    verified: boolean;
    method?: string;
    error?: string;
  }> {
    if (!localClient) {
      localClient = createLocalClient();
    }
    const result = await localClient.verifyHandleOwnership(
      state.sourceHandle,
      state.sourceDid,
    );
    if (result.verified) {
      state.existingHandleVerified = true;
      state.targetHandle = state.sourceHandle;
    }
    return result;
  }

  async function authenticateToLocal(
    email: string,
    password: string,
  ): Promise<void> {
    if (!localClient) {
      localClient = createLocalClient();
    }
    await localClient.loginDeactivated(email, password);
  }

  let passkeySetup: PasskeyAccountSetup | null = null;

  async function startMigration(): Promise<void> {
    migrationLog("startMigration START", {
      sourceDid: state.sourceDid,
      sourceHandle: state.sourceHandle,
      targetHandle: state.targetHandle,
      sourcePdsUrl: state.sourcePdsUrl,
      authMethod: state.authMethod,
    });

    if (!sourceClient || !state.sourceAccessToken) {
      migrationLog("startMigration ERROR: Not authenticated to source PDS");
      throw new Error("Not authenticated to source PDS");
    }

    if (!localClient) {
      localClient = createLocalClient();
    }

    setStep("migrating");

    try {
      setProgress({ currentOperation: "Getting service auth token..." });
      migrationLog("startMigration: Loading local server info");
      const serverInfo = await loadLocalServerInfo();
      migrationLog("startMigration: Got server info", {
        serverDid: serverInfo.did,
      });

      migrationLog(
        "startMigration: Getting service auth token from source PDS",
      );
      const { token } = await sourceClient.getServiceAuth(
        serverInfo.did,
        "com.atproto.server.createAccount",
      );
      migrationLog("startMigration: Got service auth token");
      state.serviceAuthToken = token;

      setProgress({ currentOperation: "Creating account on new PDS..." });

      if (state.authMethod === "passkey") {
        const passkeyParams = {
          did: state.sourceDid,
          handle: state.targetHandle,
          email: state.targetEmail || undefined,
          inviteCode: state.inviteCode || undefined,
          verificationChannel: state.verificationChannel,
          discordUsername: state.discordUsername || undefined,
          telegramUsername: state.telegramUsername || undefined,
          signalUsername: state.signalUsername || undefined,
        };

        migrationLog("startMigration: Creating passkey account on NEW PDS", {
          did: passkeyParams.did,
          handle: passkeyParams.handle,
          inviteCode: passkeyParams.inviteCode,
          stateInviteCode: state.inviteCode,
        });
        passkeySetup = await localClient.createPasskeyAccount(
          passkeyParams,
          token,
        );
        migrationLog("startMigration: Passkey account created on NEW PDS", {
          did: passkeySetup.did,
          hasAccessJwt: !!passkeySetup.accessJwt,
        });
        state.passkeySetupToken = passkeySetup.setupToken;
        if (passkeySetup.accessJwt) {
          localClient.setAccessToken(passkeySetup.accessJwt);
          state.localAccessToken = passkeySetup.accessJwt;
        }
      } else {
        const accountParams = {
          did: state.sourceDid,
          handle: state.targetHandle,
          email: state.targetEmail || undefined,
          password: state.targetPassword,
          inviteCode: state.inviteCode || undefined,
          verificationChannel: state.verificationChannel,
          discordUsername: state.discordUsername || undefined,
          telegramUsername: state.telegramUsername || undefined,
          signalUsername: state.signalUsername || undefined,
        };

        migrationLog("startMigration: Creating account on NEW PDS", {
          did: accountParams.did,
          handle: accountParams.handle,
        });
        const session = await localClient.createAccount(accountParams, token);
        migrationLog("startMigration: Account created on NEW PDS", {
          did: session.did,
        });
        localClient.setAccessToken(session.accessJwt);
        state.localAccessToken = session.accessJwt;
        state.localRefreshToken = session.refreshJwt;
      }

      setProgress({ currentOperation: "Exporting repository..." });
      migrationLog("startMigration: Exporting repo from source PDS");
      const exportStart = Date.now();
      const car = await sourceClient.getRepo(state.sourceDid);
      migrationLog("startMigration: Repo exported", {
        durationMs: Date.now() - exportStart,
        sizeBytes: car.byteLength,
      });
      setProgress({
        repoExported: true,
        currentOperation: "Importing repository...",
      });

      migrationLog("startMigration: Importing repo to NEW PDS");
      const importStart = Date.now();
      await localClient.importRepo(car);
      migrationLog("startMigration: Repo imported", {
        durationMs: Date.now() - importStart,
      });
      setProgress({
        repoImported: true,
        currentOperation: "Counting blobs...",
      });

      const accountStatus = await localClient.checkAccountStatus();
      migrationLog("startMigration: Account status", {
        expectedBlobs: accountStatus.expectedBlobs,
        importedBlobs: accountStatus.importedBlobs,
      });
      setProgress({
        blobsTotal: accountStatus.expectedBlobs,
        currentOperation: "Migrating blobs...",
      });

      await migrateBlobs();

      setProgress({ currentOperation: "Migrating preferences..." });
      await migratePreferences();

      migrationLog(
        "startMigration: Initial migration complete, waiting for email verification",
      );
      setStep("email-verify");
    } catch (e) {
      const err = e as Error & { error?: string; status?: number };
      const message = err.message || err.error ||
        `Unknown error (status ${err.status || "unknown"})`;
      migrationLog("startMigration FAILED", {
        error: message,
        errorCode: err.error,
        status: err.status,
        stack: err.stack,
      });
      setError(message);
      setStep("error");
    }
  }

  async function migrateBlobs(): Promise<void> {
    if (!sourceClient) {
      console.error(
        "[migration] migrateBlobs: sourceClient is null, skipping blob migration",
      );
      migrationLog("migrateBlobs SKIPPED: sourceClient is null");
      setProgress({
        currentOperation:
          "Warning: Could not migrate blobs - source PDS connection lost",
      });
      return;
    }
    if (!localClient) {
      console.error(
        "[migration] migrateBlobs: localClient is null, skipping blob migration",
      );
      migrationLog("migrateBlobs SKIPPED: localClient is null");
      setProgress({
        currentOperation:
          "Warning: Could not migrate blobs - local PDS connection lost",
      });
      return;
    }

    migrationLog("migrateBlobs: Starting blob migration", {
      sourceClientBaseUrl: sourceClient.getBaseUrl(),
      localClientBaseUrl: localClient.getBaseUrl(),
      localClientHasToken: !!localClient.getAccessToken(),
    });

    const result = await migrateBlobsUtil(
      localClient,
      sourceClient,
      state.sourceDid,
      setProgress,
    );

    state.progress.blobsFailed = result.failed;
  }

  async function migratePreferences(): Promise<void> {
    if (!sourceClient || !localClient) {
      console.warn("[migration] migratePreferences: client missing, skipping");
      return;
    }

    try {
      const prefs = await sourceClient.getPreferences();
      await localClient.putPreferences(prefs);
      setProgress({ prefsMigrated: true });
    } catch { /* optional, best-effort */ }
  }

  async function submitEmailVerifyToken(
    token: string,
    localPassword?: string,
  ): Promise<void> {
    if (!localClient) {
      localClient = createLocalClient();
    }

    state.emailVerifyToken = token;
    setError(null);

    try {
      await localClient.verifyToken(token, state.targetEmail);

      if (!sourceClient) {
        setStep("source-handle");
        setError(
          "Email verified! Please log in to your old account again to complete the migration.",
        );
        return;
      }

      if (state.authMethod === "passkey") {
        migrationLog(
          "submitEmailVerifyToken: Email verified, proceeding to passkey setup",
        );
        setStep("passkey-setup");
        return;
      }

      if (localPassword) {
        setProgress({ currentOperation: "Authenticating to new PDS..." });
        await localClient.loginDeactivated(state.targetEmail, localPassword);
      }

      if (!localClient.getAccessToken()) {
        setError("Email verified! Please enter your password to continue.");
        return;
      }

      if (state.sourceDid.startsWith("did:web:")) {
        const credentials = await localClient.getRecommendedDidCredentials();
        state.targetVerificationMethod =
          credentials.verificationMethods?.atproto || null;
        setStep("did-web-update");
      } else {
        setProgress({ currentOperation: "Requesting PLC operation token..." });
        await sourceClient.requestPlcOperationSignature();
        setStep("plc-token");
      }
    } catch (e) {
      const err = e as Error & { error?: string; status?: number };
      const message = err.message || err.error ||
        `Unknown error (status ${err.status || "unknown"})`;
      setError(message);
    }
  }

  async function resendEmailVerification(): Promise<void> {
    if (!localClient) {
      localClient = createLocalClient();
    }
    await localClient.resendMigrationVerification(
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

  async function proceedAfterVerification(): Promise<void> {
    if (state.authMethod === "passkey") {
      setStep("passkey-setup");
      return;
    }

    if (!localClient!.getAccessToken()) {
      await localClient!.loginDeactivated(
        state.targetEmail,
        state.targetPassword,
      );
    }

    if (!sourceClient) {
      setStep("source-handle");
      setError(
        "Email verified! Please log in to your old account again to complete the migration.",
      );
      return;
    }

    if (state.sourceDid.startsWith("did:web:")) {
      const credentials = await localClient!.getRecommendedDidCredentials();
      state.targetVerificationMethod =
        credentials.verificationMethods?.atproto || null;
      setStep("did-web-update");
    } else {
      await sourceClient.requestPlcOperationSignature();
      setStep("plc-token");
    }
  }

  const verificationPoller = createEmailVerificationPoller({
    async checkVerified() {
      if (!localClient) return false;
      return localClient.checkChannelVerified(
        state.sourceDid,
        state.verificationChannel,
      );
    },
    async onVerified() {
      await proceedAfterVerification();
    },
  });

  function checkEmailVerifiedAndProceed(): Promise<boolean> {
    return verificationPoller.checkAndAdvance();
  }

  async function submitPlcToken(token: string): Promise<void> {
    migrationLog("submitPlcToken START", {
      sourceDid: state.sourceDid,
      sourceHandle: state.sourceHandle,
      targetHandle: state.targetHandle,
      sourcePdsUrl: state.sourcePdsUrl,
    });

    if (!sourceClient || !localClient) {
      migrationLog("submitPlcToken ERROR: Not connected to PDSes", {
        hasSourceClient: !!sourceClient,
        hasLocalClient: !!localClient,
      });
      throw new Error("Not connected to PDSes");
    }

    state.plcToken = token;
    setStep("finalizing");
    setProgress({ currentOperation: "Signing PLC operation..." });

    try {
      migrationLog("Step 1: Getting recommended DID credentials from NEW PDS");
      const credentials = await localClient.getRecommendedDidCredentials();
      migrationLog("Step 1 COMPLETE: Got credentials", {
        rotationKeys: credentials.rotationKeys,
        alsoKnownAs: credentials.alsoKnownAs,
        verificationMethods: credentials.verificationMethods,
        services: credentials.services,
      });

      migrationLog("Step 2: Signing PLC operation on source PDS", {
        sourcePdsUrl: state.sourcePdsUrl,
      });
      const signStart = Date.now();
      const { operation } = await sourceClient.signPlcOperation({
        token,
        ...credentials,
      });
      migrationLog("Step 2 COMPLETE: PLC operation signed", {
        durationMs: Date.now() - signStart,
        operationType: operation.type,
        operationPrev: operation.prev,
      });

      setProgress({
        plcSigned: true,
        currentOperation: "Submitting PLC operation...",
      });
      migrationLog("Step 3: Submitting PLC operation to NEW PDS");
      const submitStart = Date.now();
      await localClient.submitPlcOperation(operation);
      migrationLog("Step 3 COMPLETE: PLC operation submitted", {
        durationMs: Date.now() - submitStart,
      });

      setProgress({
        currentOperation: "Activating account (waiting for DID propagation)...",
      });
      migrationLog("Step 4: Activating account on NEW PDS");
      const activateStart = Date.now();
      await localClient.activateAccount();
      migrationLog("Step 4 COMPLETE: Account activated on NEW PDS", {
        durationMs: Date.now() - activateStart,
      });
      setProgress({ activated: true });

      setProgress({ currentOperation: "Deactivating old account..." });
      migrationLog("Step 5: Deactivating account on source PDS", {
        sourcePdsUrl: state.sourcePdsUrl,
      });
      const deactivateStart = Date.now();
      try {
        await sourceClient.deactivateAccount();
        migrationLog("Step 5 COMPLETE: Account deactivated on source PDS", {
          durationMs: Date.now() - deactivateStart,
          success: true,
        });
        setProgress({ deactivated: true });
      } catch (deactivateErr) {
        console.error(
          "[MIGRATION] Failed to deactivate old account on source PDS",
          deactivateErr,
        );
      }

      migrationLog("submitPlcToken SUCCESS: Migration complete", {
        sourceDid: state.sourceDid,
        newHandle: state.targetHandle,
      });
      setStep("success");
      clearMigrationState();
    } catch (e) {
      const err = e as Error & { error?: string; status?: number };
      const message = err.message || err.error ||
        `Unknown error (status ${err.status || "unknown"})`;
      migrationLog("submitPlcToken FAILED", {
        error: message,
        errorCode: err.error,
        status: err.status,
        stack: err.stack,
      });
      state.step = "plc-token";
      state.error = message;
      saveMigrationState(state);
    }
  }

  async function requestPlcToken(): Promise<void> {
    if (!sourceClient) {
      throw new Error("Not connected to source PDS");
    }
    setProgress({ currentOperation: "Requesting PLC operation token..." });
    await sourceClient.requestPlcOperationSignature();
  }

  async function resendPlcToken(): Promise<void> {
    if (!sourceClient) {
      throw new Error("Not connected to source PDS");
    }
    await sourceClient.requestPlcOperationSignature();
  }

  async function completeDidWebMigration(): Promise<void> {
    migrationLog("completeDidWebMigration START", {
      sourceDid: state.sourceDid,
      sourceHandle: state.sourceHandle,
      targetHandle: state.targetHandle,
    });

    if (!sourceClient || !localClient) {
      migrationLog("completeDidWebMigration ERROR: Not connected to PDSes");
      throw new Error("Not connected to PDSes");
    }

    setStep("finalizing");
    setProgress({ currentOperation: "Activating account..." });

    try {
      migrationLog("Activating account on NEW PDS");
      const activateStart = Date.now();
      await localClient.activateAccount();
      migrationLog("Account activated", {
        durationMs: Date.now() - activateStart,
      });
      setProgress({ activated: true });

      setProgress({ currentOperation: "Deactivating old account..." });
      migrationLog("Deactivating account on source PDS");
      const deactivateStart = Date.now();
      try {
        await sourceClient.deactivateAccount();
        migrationLog("Account deactivated on source PDS", {
          durationMs: Date.now() - deactivateStart,
        });
        setProgress({ deactivated: true });
      } catch (deactivateErr) {
        console.error(
          "[MIGRATION] Failed to deactivate old account on source PDS",
          deactivateErr,
        );
      }

      migrationLog("completeDidWebMigration SUCCESS");
      setStep("success");
      clearMigrationState();
    } catch (e) {
      const err = e as Error & { error?: string; status?: number };
      const message = err.message || err.error ||
        `Unknown error (status ${err.status || "unknown"})`;
      migrationLog("completeDidWebMigration FAILED", { error: message });
      setError(message);
      setStep("did-web-update");
    }
  }

  async function startPasskeyRegistration(): Promise<{ options: unknown }> {
    if (!localClient || !state.passkeySetupToken) {
      throw new Error("Not ready for passkey registration");
    }

    migrationLog("startPasskeyRegistration START", { did: state.sourceDid });
    const result = await localClient.startPasskeyRegistrationForSetup(
      state.sourceDid,
      state.passkeySetupToken,
    );
    migrationLog("startPasskeyRegistration: Got WebAuthn options");
    return result;
  }

  async function completePasskeyRegistration(
    credential: unknown,
    friendlyName?: string,
  ): Promise<void> {
    if (!localClient || !state.passkeySetupToken || !sourceClient) {
      throw new Error("Not ready for passkey registration");
    }

    migrationLog("completePasskeyRegistration START", { did: state.sourceDid });

    const result = await localClient.completePasskeySetup(
      state.sourceDid,
      state.passkeySetupToken,
      credential,
      friendlyName,
    );
    migrationLog("completePasskeyRegistration: Passkey registered", {
      appPassword: "***",
    });

    setProgress({ currentOperation: "Authenticating with app password..." });
    await localClient.loginDeactivated(state.targetEmail, result.appPassword);
    migrationLog("completePasskeyRegistration: Authenticated to new PDS");

    state.generatedAppPassword = result.appPassword;
    state.generatedAppPasswordName = result.appPasswordName;
    setStep("app-password");
  }

  async function proceedFromAppPassword(): Promise<void> {
    if (!sourceClient || !localClient) {
      throw new Error("Clients not initialized");
    }

    migrationLog("proceedFromAppPassword: Starting");

    if (state.sourceDid.startsWith("did:web:")) {
      const credentials = await localClient.getRecommendedDidCredentials();
      state.targetVerificationMethod =
        credentials.verificationMethods?.atproto || null;
      setStep("did-web-update");
    } else {
      setProgress({ currentOperation: "Requesting PLC operation token..." });
      await sourceClient.requestPlcOperationSignature();
      setStep("plc-token");
    }
  }

  function reset(): void {
    state = {
      direction: "inbound",
      step: "welcome",
      sourcePdsUrl: "",
      sourceDid: "",
      sourceHandle: "",
      targetHandle: "",
      targetEmail: "",
      targetPassword: "",
      inviteCode: "",
      sourceAccessToken: null,
      sourceRefreshToken: null,
      serviceAuthToken: null,
      emailVerifyToken: "",
      plcToken: "",
      progress: createInitialProgress(),
      error: null,
      targetVerificationMethod: null,
      authMethod: "password",
      passkeySetupToken: null,
      oauthCodeVerifier: null,
      localAccessToken: null,
      localRefreshToken: null,
      generatedAppPassword: null,
      generatedAppPasswordName: null,
      handlePreservation: "new",
      existingHandleVerified: false,
      verificationChannel: "email",
      discordUsername: "",
      telegramUsername: "",
      signalUsername: "",
    };
    sourceClient = null;
    passkeySetup = null;
    clearMigrationState();
    clearDPoPKey();
  }

  async function resumeFromState(stored: StoredMigrationState): Promise<void> {
    if (stored.direction !== "inbound") return;

    state.sourcePdsUrl = stored.sourcePdsUrl;
    state.sourceDid = stored.sourceDid;
    state.sourceHandle = stored.sourceHandle;
    state.targetHandle = stored.targetHandle;
    state.targetEmail = stored.targetEmail;
    state.authMethod = stored.authMethod ?? "password";
    state.localAccessToken = stored.localAccessToken ?? null;
    state.localRefreshToken = stored.localRefreshToken ?? null;
    state.progress = {
      ...createInitialProgress(),
      ...stored.progress,
    };

    const stepsRequiringSourceAuth = [
      "choose-handle",
      "review",
      "migrating",
      "email-verify",
      "plc-token",
      "did-web-update",
      "finalizing",
      "app-password",
    ];

    if (stepsRequiringSourceAuth.includes(stored.step)) {
      state.step = "source-handle";
      state.needsReauth = true;
      state.resumeToStep = stored.step as InboundMigrationState["step"];
      migrationLog("resumeFromState: Requiring re-auth for step", {
        originalStep: stored.step,
      });
    } else if (stored.step === "passkey-setup" && stored.passkeySetupToken) {
      state.passkeySetupToken = stored.passkeySetupToken;
      localClient = createLocalClient();
      state.step = "passkey-setup";
      migrationLog("resumeFromState: Restored passkey-setup with token");
    } else if (stored.step === "success") {
      state.step = "success";
    } else if (stored.step === "error") {
      state.step = "source-handle";
      state.needsReauth = true;
      migrationLog("resumeFromState: Error state, requiring re-auth");
    } else {
      state.step = stored.step as InboundMigrationState["step"];
    }
  }

  function getLocalSession():
    | { accessJwt: string; did: string; handle: string }
    | null {
    if (!localClient) return null;
    const token = localClient.getAccessToken();
    if (!token) return null;
    return {
      accessJwt: token,
      did: state.sourceDid,
      handle: state.targetHandle,
    };
  }

  return {
    get state() {
      return state;
    },
    get passkeySetup() {
      return passkeySetup;
    },
    setStep,
    setError,
    loadLocalServerInfo,
    loadSourcePdsDomains,
    resolveSourcePds,
    initiateOAuthLogin,
    handleOAuthCallback,
    authenticateToLocal,
    checkHandleAvailability,
    verifyExistingHandle,
    startMigration,
    submitEmailVerifyToken,
    resendEmailVerification,
    checkEmailVerifiedAndProceed,
    requestPlcToken,
    submitPlcToken,
    resendPlcToken,
    completeDidWebMigration,
    startPasskeyRegistration,
    completePasskeyRegistration,
    proceedFromAppPassword,
    reset,
    resumeFromState,
    getLocalSession,

    updateField<K extends keyof InboundMigrationState>(
      field: K,
      value: InboundMigrationState[K],
    ) {
      state[field] = value;
    },
  };
}

export type InboundMigrationFlow = ReturnType<
  typeof createInboundMigrationFlow
>;
