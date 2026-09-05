import { version as reactVersion, useCallback, useState } from "react";
import vitePackage from "vite/package.json";
import {
  Alert,
  Button,
  Card,
  Loading,
  PageHeading,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api } from "../../lib/api.ts";
import { useTranslation } from "../../lib/i18n.ts";

type AboutRow = { label: string; value: string; href?: string };

function AboutSection({ title, rows }: { title: string; rows: AboutRow[] }) {
  return (
    <section className="grid gap-3">
      <h2 className="font-mono text-sm font-semibold text-ctp-lavender">
        {title}
      </h2>
      <Card className="overflow-hidden">
        <dl className="divide-y divide-ctp-surface-0 text-sm">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid gap-1 px-5 py-4 sm:grid-cols-[11rem_1fr]"
            >
              <dt className="font-semibold text-ctp-subtext-0">{row.label}</dt>
              <dd className="font-mono break-all text-ctp-text">
                {row.href ? (
                  <a href={row.href} target="_blank" rel="noopener noreferrer">
                    {row.value}
                  </a>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}

export function AboutPage() {
  const session = useSession();
  const t = useTranslation();
  const loadAbout = useCallback(async () => {
    const [server, stats] = await Promise.all([
      api.describeServer().catch(() => null),
      session.isAdmin
        ? api.getServerStats(session.accessJwt).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { server, stats };
  }, [session.accessJwt, session.isAdmin]);
  const resource = useAsync(loadAbout);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (resource.loading) return <Loading label={t("common.loading")} />;

  const server = resource.data?.server;
  const stats = resource.data?.stats;
  const unknown = t("about.unknown");
  const notConfigured = t("about.notConfigured");
  const yesNo = (value: boolean | undefined) =>
    value ? t("about.yes") : t("about.no");
  const enabledDisabled = (value: boolean | undefined) =>
    value ? t("about.enabled") : t("about.disabled");
  const screenSize = `${globalThis.innerWidth ?? 0}x${globalThis.innerHeight ?? 0}`;

  const sections = [
    {
      title: t("about.serverSection"),
      rows: [
        { label: t("about.serverUrl"), value: globalThis.location.origin },
        { label: t("about.pdsVersion"), value: server?.version ?? unknown },
        { label: t("about.serverDid"), value: server?.did ?? unknown },
        {
          label: t("about.availableDomains"),
          value: server?.availableUserDomains.join(", ") ?? unknown,
        },
        {
          label: t("about.inviteCodeRequired"),
          value: yesNo(server?.inviteCodeRequired),
        },
        {
          label: t("about.selfHostedDidWeb"),
          value: enabledDisabled(server?.selfHostedDidWebEnabled),
        },
        ...(stats
          ? [
              {
                label: t("about.userCount"),
                value: stats.userCount.toLocaleString(),
              },
            ]
          : []),
      ],
    },
    {
      title: t("about.contactSection"),
      rows: [
        {
          label: t("about.contactEmail"),
          value: server?.contact?.email ?? notConfigured,
        },
        {
          label: t("about.privacyPolicy"),
          value: server?.links?.privacyPolicy ?? notConfigured,
          href: server?.links?.privacyPolicy,
        },
        {
          label: t("about.termsOfService"),
          value: server?.links?.termsOfService ?? notConfigured,
          href: server?.links?.termsOfService,
        },
      ],
    },
    ...(session.isAdmin
      ? [
          {
            title: t("about.communicationSection"),
            rows: [
              {
                label: t("about.availableChannels"),
                value: server?.availableCommsChannels?.join(", ") ?? unknown,
              },
              {
                label: t("about.discordBot"),
                value: server?.discordBotUsername ?? notConfigured,
              },
              {
                label: t("about.discordAppId"),
                value: server?.discordAppId ?? notConfigured,
              },
              {
                label: t("about.telegramBot"),
                value: server?.telegramBotUsername ?? notConfigured,
              },
            ],
          },
          {
            title: t("about.frontendSection"),
            rows: [
              { label: "React", value: reactVersion },
              { label: t("about.viteVersion"), value: vitePackage.version },
              { label: t("about.buildMode"), value: import.meta.env.MODE },
            ],
          },
        ]
      : []),
    {
      title: t("about.accountSection"),
      rows: [
        { label: t("about.did"), value: session.did },
        { label: t("about.handle"), value: session.handle },
        { label: t("about.accountStatus"), value: session.accountKind },
        { label: t("about.adminStatus"), value: yesNo(session.isAdmin) },
      ],
    },
    {
      title: t("about.environmentSection"),
      rows: [
        { label: t("about.userAgent"), value: navigator.userAgent },
        { label: t("about.locale"), value: navigator.language },
        { label: t("about.screenSize"), value: screenSize },
      ],
    },
  ];

  async function copyDebugInfo() {
    const lines = sections.flatMap((section) => [
      section.title,
      ...section.rows.map((row) => `${row.label}: ${row.value}`),
      "",
    ]);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopyError(t("about.copyFailed"));
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeading
        title={t("about.title")}
        description={t("about.serverSection")}
        actions={
          <Button onClick={() => void copyDebugInfo()}>
            {copied ? t("about.copied") : t("about.copyDebugInfo")}
          </Button>
        }
      />
      {copyError ? <Alert tone="error">{copyError}</Alert> : null}
      {!server ? (
        <Alert tone="warning">{t("admin.failedToLoadConfig")}</Alert>
      ) : null}
      {sections.map((section) => (
        <AboutSection
          key={section.title}
          title={section.title}
          rows={section.rows}
        />
      ))}
    </div>
  );
}
