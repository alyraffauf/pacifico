export function getSiteHostname(): string {
  if (typeof globalThis.location === "undefined") return "this PDS";
  return globalThis.location.hostname || "this PDS";
}

const defaultSiteIcon = "/site-mark.png";

export function getSiteIconPath(logoCid: string | null): string {
  return logoCid
    ? `/favicon.ico?v=${encodeURIComponent(logoCid)}`
    : defaultSiteIcon;
}

export function applySiteIcon(logoCid: string | null): void {
  if (typeof document === "undefined") return;

  const iconPath = getSiteIconPath(logoCid);

  for (const selector of [
    'link[rel~="icon"]',
    'link[rel="apple-touch-icon"]',
  ]) {
    document
      .querySelector<HTMLLinkElement>(selector)
      ?.setAttribute("href", iconPath);
  }
}
