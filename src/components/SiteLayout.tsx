import { IconArrowRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageContainer } from "./PageContainer.tsx";
import { getSiteHostname } from "../lib/site.ts";
import { SiteMark } from "./SiteMark.tsx";

export function SiteLayout({ children }: { children: ReactNode }) {
  const hostname = getSiteHostname();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ctp-surface0 bg-ctp-crust">
        <PageContainer className="flex min-h-16 items-center justify-between gap-4 py-3">
          <Link
            to="/"
            className="flex items-center gap-3 font-mono text-sm font-semibold tracking-wide text-ctp-text no-underline"
          >
            <SiteMark className="h-8 w-7" />
            {hostname}
          </Link>
          <Link
            to="/app/"
            className="inline-flex items-center gap-2 text-sm font-medium no-underline"
          >
            Open account
            <IconArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </PageContainer>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
      <footer className="border-t border-ctp-surface0 bg-ctp-crust">
        <PageContainer className="flex justify-end py-6 text-sm">
          <nav aria-label="Footer navigation" className="flex gap-4">
            <a href="https://atproto.com" target="_blank" rel="noreferrer">
              AT Protocol
            </a>
            <a
              href="https://tangled.org/tranquil.farm/tranquil-pds"
              target="_blank"
              rel="noreferrer"
            >
              Tranquil PDS
            </a>
          </nav>
        </PageContainer>
      </footer>
    </div>
  );
}
