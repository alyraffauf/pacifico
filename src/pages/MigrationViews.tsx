import { Link } from "react-router-dom";
import { Alert, Button, Card } from "../components/ui.tsx";
import { MigrationFrame } from "./MigrationWizards.tsx";

export type PendingResume =
  | {
      direction: "inbound";
      sourceHandle: string;
      targetHandle: string;
      progressSummary: string;
    }
  | { direction: "offline"; userDid: string; targetHandle: string };

export function MigrationErrorView({
  error,
  onStartOver,
}: {
  error: string;
  onStartOver: () => void;
}) {
  return (
    <MigrationFrame title="Could not continue migration">
      <Alert tone="error">{error}</Alert>
      <Button onClick={onStartOver}>Start over</Button>
    </MigrationFrame>
  );
}

export function MigrationResumeView({
  pending,
  busy,
  onResume,
  onStartOver,
}: {
  pending: PendingResume;
  busy: boolean;
  onResume: () => void;
  onStartOver: () => void;
}) {
  return (
    <MigrationFrame
      title="Resume migration"
      description="A migration started in this browser has not finished."
    >
      <Card className="grid gap-3 p-4 text-sm">
        {pending.direction === "inbound" ? (
          <>
            <p>
              <span className="text-ctp-overlay1">From</span>
              <br />@{pending.sourceHandle}
            </p>
            {pending.targetHandle ? (
              <p>
                <span className="text-ctp-overlay1">To</span>
                <br />@{pending.targetHandle}
              </p>
            ) : null}
            <p>
              <span className="text-ctp-overlay1">Progress</span>
              <br />
              {pending.progressSummary}
            </p>
          </>
        ) : (
          <>
            <p>
              <span className="text-ctp-overlay1">DID</span>
              <br />
              <span className="font-mono text-xs">{pending.userDid}</span>
            </p>
            {pending.targetHandle ? (
              <p>
                <span className="text-ctp-overlay1">Handle</span>
                <br />@{pending.targetHandle}
              </p>
            ) : null}
          </>
        )}
      </Card>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy} onClick={onResume}>
          {busy ? "Resuming" : "Resume"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onStartOver}>
          Start over
        </Button>
      </div>
    </MigrationFrame>
  );
}

export function MigrationChooser({
  onInbound,
  onOffline,
}: {
  onInbound: () => void;
  onOffline: () => void;
}) {
  return (
    <MigrationFrame
      title="Move an account"
      description={`Bring an existing AT Protocol identity to ${globalThis.location.hostname}.`}
    >
      <button
        type="button"
        className="rounded border border-ctp-surface1 bg-ctp-mantle p-5 text-left hover:border-ctp-lavender"
        onClick={onInbound}
      >
        <strong className="font-mono text-ctp-text">
          Move from another PDS
        </strong>
        <span className="mt-2 block text-sm text-ctp-subtext0">
          Connect the current host over OAuth and transfer the repository,
          blobs, and identity.
        </span>
      </button>
      <button
        type="button"
        className="rounded border border-ctp-surface1 bg-ctp-mantle p-5 text-left hover:border-ctp-lavender"
        onClick={onOffline}
      >
        <strong className="font-mono text-ctp-text">
          Restore an offline backup
        </strong>
        <span className="mt-2 block text-sm text-ctp-subtext0">
          Recover from a CAR export and PLC rotation key when the old host is
          unavailable.
        </span>
      </button>
      <Link className="text-center text-sm" to="/app/register">
        Back to registration
      </Link>
    </MigrationFrame>
  );
}
