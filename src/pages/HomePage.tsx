import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { PageContainer } from "../components/PageContainer.tsx";
import { SiteLayout } from "../components/SiteLayout.tsx";
import { buttonClasses } from "../components/ui.tsx";
import { getSiteHostname } from "../lib/site.ts";

export function HomePage() {
  const hostname = getSiteHostname();

  return (
    <SiteLayout>
      <main className="flex flex-1 bg-ctp-base">
        <section className="flex flex-1">
          <PageContainer className="grid flex-1 items-center gap-6 py-8 sm:grid-cols-2 sm:gap-12 sm:py-14">
            <img
              src="/site-mark.png"
              alt=""
              className="order-1 mx-auto h-52 w-auto object-contain sm:order-2 sm:h-112"
            />
            <div className="order-2 w-full max-w-md rounded border border-ctp-surface1/70 bg-ctp-crust p-5 shadow-xl sm:order-1 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
              <p className="font-mono text-xs tracking-wide text-ctp-overlay1 uppercase">
                Personal data server
              </p>
              <h1 className="mt-2 font-mono text-2xl font-bold break-all text-ctp-text sm:mt-3 sm:text-4xl">
                {hostname}
              </h1>
              <p className="mt-3 text-sm leading-6 text-ctp-subtext0 sm:mt-4">
                Your account, identity, and data live here.
              </p>
              <div className="mt-5 flex flex-col gap-2.5 sm:mt-7 sm:flex-row sm:gap-3">
                <Link
                  to="/app/login"
                  className={buttonClasses("primary", "no-underline")}
                >
                  Sign in{" "}
                  <IconArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link
                  to="/app/register"
                  className={buttonClasses("secondary", "no-underline")}
                >
                  Create account
                </Link>
              </div>
              <p className="mt-4 text-sm sm:mt-5">
                <Link to="/app/migrate">Move an existing account here</Link>
              </p>
            </div>
          </PageContainer>
        </section>
      </main>
    </SiteLayout>
  );
}
