import type { ReactNode } from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import type { Session } from "../../lib/types/api.ts";

export function DashboardPreviewFrame({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-ctp-base px-4 py-8 text-ctp-text sm:px-6">
      <div className="mx-auto grid max-w-[52rem] gap-6">
        <div className="rounded border border-ctp-blue/40 bg-ctp-blue/10 px-4 py-3 font-mono text-xs text-ctp-blue">
          Development preview at {path}. Changes stay in this tab.
        </div>
        {children}
      </div>
    </main>
  );
}

export function DashboardPreview({
  path,
  session,
  children,
}: {
  path: string;
  session: Session;
  children: ReactNode;
}) {
  return (
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={session} />}>
          <Route
            index
            element={
              <DashboardPreviewFrame path={path}>
                {children}
              </DashboardPreviewFrame>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}
