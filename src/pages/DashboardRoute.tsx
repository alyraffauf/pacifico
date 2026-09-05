import { Navigate, Outlet } from "react-router-dom";
import { DashboardLayout } from "../components/DashboardLayout.tsx";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Loading } from "../components/ui.tsx";
import { useAuthState } from "../hooks/useAuthState.ts";

export function DashboardRoute() {
  const auth = useAuthState();
  if (auth.kind === "loading")
    return (
      <AuthLayout title="Opening your account">
        <Loading />
      </AuthLayout>
    );
  if (auth.kind !== "authenticated")
    return <Navigate to="/app/login" replace />;
  return (
    <DashboardLayout session={auth.session}>
      <Outlet context={auth.session} />
    </DashboardLayout>
  );
}
