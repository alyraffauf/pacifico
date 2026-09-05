import type { ReactNode } from "react";
import { Card } from "../../components/ui.tsx";
import type { ServerStats } from "../../lib/types/api.ts";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function ServerSummary({
  stats,
  labels,
}: {
  stats: ServerStats;
  labels: {
    users: string;
    repos: string;
    records: string;
    blobStorage: string;
  };
}) {
  const values = [
    [labels.users, stats.userCount.toLocaleString()],
    [labels.repos, stats.repoCount.toLocaleString()],
    [labels.records, stats.recordCount.toLocaleString()],
    [labels.blobStorage, formatBytes(stats.blobStorageBytes)],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {values.map(([label, value]) => (
        <Card key={label} className="p-4">
          <p className="text-xs tracking-wide text-ctp-overlay1 uppercase">
            {label}
          </p>
          <p className="mt-2 font-mono text-xl font-bold text-ctp-text">
            {value}
          </p>
        </Card>
      ))}
    </div>
  );
}

export function ServerConfigurationSections({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="grid gap-4 xl:grid-cols-2">{children}</div>;
}

export function AccountAdministrationSection({
  children,
}: {
  children: ReactNode;
}) {
  return <section className="grid gap-3">{children}</section>;
}

export function InviteCodeSection({ children }: { children: ReactNode }) {
  return <section className="grid gap-3">{children}</section>;
}
