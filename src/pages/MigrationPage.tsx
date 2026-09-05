import { useEffect, useRef, useState } from "react";
import {
  clearMigrationState,
  clearOfflineState,
  createInboundMigrationFlow,
  createOfflineInboundMigrationFlow,
  getOfflineResumeInfo,
  getResumeInfo,
  hasPendingOfflineMigration,
  hasPendingMigration,
  loadMigrationState,
  type InboundMigrationFlow,
  type OfflineInboundMigrationFlow,
} from "../lib/migration/index.ts";
import { InboundWizard, OfflineWizard } from "./MigrationWizards.tsx";
import {
  MigrationChooser,
  MigrationErrorView,
  MigrationResumeView,
  type PendingResume,
} from "./MigrationViews.tsx";

type Direction = "select" | "inbound" | "offline";
export function MigrationPage() {
  const [direction, setDirection] = useState<Direction>("select");
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [pendingResume, setPendingResume] = useState<PendingResume | null>(
    null,
  );
  const [resumeBusy, setResumeBusy] = useState(false);
  const [inboundFlow] = useState(() => createInboundMigrationFlow());
  const [offlineFlow] = useState(() => createOfflineInboundMigrationFlow());
  const callbackHandled = useRef(false);
  const pendingMigrationChecked = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error_description") ?? params.get("error");
    if (code || error) {
      if (callbackHandled.current) return;
      callbackHandled.current = true;
      globalThis.history.replaceState({}, "", "/app/migrate");
      if (error) {
        queueMicrotask(() => setCallbackError(error));
        return;
      }
      if (!code || !state) return;
      const flow = inboundFlow;
      queueMicrotask(() => setDirection("inbound"));
      void (async () => {
        const stored = loadMigrationState();
        if (stored?.direction === "inbound") await flow.resumeFromState(stored);
        await flow.handleOAuthCallback(code, state);
      })().catch((caught) =>
        setCallbackError(
          caught instanceof Error
            ? caught.message
            : "OAuth authentication failed.",
        ),
      );
      return;
    }

    if (pendingMigrationChecked.current) return;
    pendingMigrationChecked.current = true;
    if (hasPendingMigration()) {
      const info = getResumeInfo();
      if (info?.step === "success") clearMigrationState();
      else if (info)
        queueMicrotask(() =>
          setPendingResume({
            direction: "inbound",
            sourceHandle: info.sourceHandle,
            targetHandle: info.targetHandle,
            progressSummary: info.progressSummary,
          }),
        );
      return;
    }
    if (hasPendingOfflineMigration()) {
      const info = getOfflineResumeInfo();
      if (info?.step === "success") clearOfflineState();
      else if (info)
        queueMicrotask(() =>
          setPendingResume({
            direction: "offline",
            userDid: info.userDid,
            targetHandle: info.targetHandle,
          }),
        );
    }
  }, [inboundFlow]);

  async function resumeMigration() {
    if (!pendingResume) return;
    setResumeBusy(true);
    try {
      if (pendingResume.direction === "inbound") {
        const stored = loadMigrationState();
        if (!stored) throw new Error("The saved migration has expired.");
        await inboundFlow.resumeFromState(stored);
        setDirection("inbound");
      } else {
        if (!offlineFlow.tryResume())
          throw new Error("The saved restore has expired.");
        setDirection("offline");
      }
      setPendingResume(null);
    } catch (caught) {
      setCallbackError(
        caught instanceof Error
          ? caught.message
          : "Could not resume migration.",
      );
    } finally {
      setResumeBusy(false);
    }
  }

  function startOver() {
    if (pendingResume?.direction === "offline") clearOfflineState();
    else clearMigrationState();
    inboundFlow.reset();
    offlineFlow.reset();
    setPendingResume(null);
    setCallbackError(null);
    setDirection("select");
  }

  function leaveWizard(
    flow: InboundMigrationFlow | OfflineInboundMigrationFlow,
  ) {
    flow.reset();
    setDirection("select");
  }

  if (callbackError)
    return <MigrationErrorView error={callbackError} onStartOver={startOver} />;
  if (pendingResume)
    return (
      <MigrationResumeView
        pending={pendingResume}
        busy={resumeBusy}
        onResume={() => void resumeMigration()}
        onStartOver={startOver}
      />
    );
  if (direction === "inbound") {
    return (
      <InboundWizard
        flow={inboundFlow}
        onBack={() => leaveWizard(inboundFlow)}
      />
    );
  }
  if (direction === "offline") {
    return (
      <OfflineWizard
        flow={offlineFlow}
        onBack={() => leaveWizard(offlineFlow)}
      />
    );
  }
  return (
    <MigrationChooser
      onInbound={() => {
        inboundFlow.reset();
        setDirection("inbound");
      }}
      onOffline={() => {
        offlineFlow.reset();
        setDirection("offline");
      }}
    />
  );
}
