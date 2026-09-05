import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "./ui.tsx";
import { getSiteHostname } from "../lib/site.ts";
import { SiteMark } from "./SiteMark.tsx";

export function AuthLayout({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const hostname = getSiteHostname();

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className={wide ? "w-full max-w-5xl" : "w-full max-w-md"}>
        <Link
          to="/"
          className="mb-6 flex items-center justify-center gap-3 font-mono text-sm font-semibold text-ctp-text no-underline"
        >
          <SiteMark className="h-11 w-10" />
          {hostname}
        </Link>
        <Card className="p-6 sm:p-8">
          <header className="mb-6">
            <h1 className="font-mono text-2xl font-bold text-ctp-text">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 text-sm leading-6 text-ctp-subtext0">
                {description}
              </p>
            ) : null}
          </header>
          {children}
        </Card>
      </div>
    </main>
  );
}
