import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { PageContainer } from "../components/PageContainer.tsx";
import { SiteLayout } from "../components/SiteLayout.tsx";
import { getSiteHostname } from "../lib/site.ts";

export function HomePage() {
  const hostname = getSiteHostname();

  return (
    <SiteLayout>
      <main>
        <section className="home-hero min-h-[calc(100svh-8.25rem)] bg-ctp-base">
          <PageContainer className="grid min-h-[calc(100svh-8.25rem)] items-center gap-6 py-8 sm:grid-cols-[minmax(0,0.9fr)_minmax(18rem,1.1fr)] sm:gap-12 sm:py-14">
            <img src="/site-mark.png" alt="" className="order-1 mx-auto h-52 w-auto object-contain sm:order-2 sm:h-[28rem]" />
            <div className="order-2 w-full max-w-md rounded border border-ctp-surface-1/70 bg-ctp-crust p-5 shadow-xl sm:order-1 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
              <p className="font-mono text-xs uppercase tracking-wide text-ctp-overlay-1">Personal data server</p>
              <h1 className="mt-2 break-all font-mono text-2xl font-bold text-ctp-text sm:mt-3 sm:text-4xl">{hostname}</h1>
              <p className="mt-3 text-sm leading-6 text-ctp-subtext-0 sm:mt-4">Your account, identity, and data live here.</p>
              <div className="mt-5 flex flex-col gap-2.5 sm:mt-7 sm:flex-row sm:gap-3">
                <Link to="/app/login" className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-ctp-lavender bg-ctp-lavender px-4 py-2 text-sm font-semibold text-ctp-crust no-underline hover:border-ctp-blue hover:bg-ctp-blue hover:text-ctp-crust">Sign in <IconArrowRight className="size-4" aria-hidden="true" /></Link>
                <Link to="/app/register" className="inline-flex min-h-10 items-center justify-center rounded border border-ctp-surface-1 bg-ctp-surface-0 px-4 py-2 text-sm font-semibold text-ctp-text no-underline hover:border-ctp-lavender hover:text-ctp-text">Create account</Link>
              </div>
              <p className="mt-4 text-sm sm:mt-5"><Link to="/app/migrate">Move an existing account here</Link></p>
            </div>
          </PageContainer>
        </section>
      </main>
    </SiteLayout>
  );
}
