import { Navigate, Outlet } from "react-router-dom";
import { DashboardLayout } from "../components/DashboardLayout.tsx";
import { useAuthState } from "../hooks/useAuthState.ts";

export function DashboardRoute() {
  const auth = useAuthState();
  if (auth.kind === "loading") return null;
  if (auth.kind !== "authenticated")
    return <Navigate to="/app/login" replace />;
  return (
    <DashboardLayout session={auth.session}>
      <Outlet context={auth.session} />
    </DashboardLayout>
  );
}
