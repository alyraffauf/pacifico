import { lazy, Suspense, useEffect, useRef, type ComponentType } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AuthLayout } from "./components/AuthLayout.tsx";
import { Loading } from "./components/ui.tsx";
import { useAuthState } from "./hooks/useAuthState.ts";
import { initAuth } from "./lib/auth.ts";
import { HomePage } from "./pages/HomePage.tsx";

function page<T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
) {
  return lazy(async () => ({
    default: (await loader())[name] as ComponentType,
  }));
}

const LoginPage = page(() => import("./pages/LoginPage.tsx"), "LoginPage");
const RegisterPage = page(
  () => import("./pages/RegisterPage.tsx"),
  "RegisterPage",
);
const VerifyPage = page(() => import("./pages/VerifyPage.tsx"), "VerifyPage");
const ActAsPage = page(() => import("./pages/ActAsPage.tsx"), "ActAsPage");
const MigrationPage = page(
  () => import("./pages/MigrationPage.tsx"),
  "MigrationPage",
);
const DashboardRoute = page(
  () => import("./pages/DashboardRoute.tsx"),
  "DashboardRoute",
);
const RecoverPasskeyPage = page(
  () => import("./pages/AccountRecoveryPages.tsx"),
  "RecoverPasskeyPage",
);
const RequestPasskeyRecoveryPage = page(
  () => import("./pages/AccountRecoveryPages.tsx"),
  "RequestPasskeyRecoveryPage",
);
const ResetPasswordPage = page(
  () => import("./pages/AccountRecoveryPages.tsx"),
  "ResetPasswordPage",
);
const AboutPage = page(
  () => import("./pages/dashboard/AboutPage.tsx"),
  "AboutPage",
);
const AppPasswordsPage = page(
  () => import("./pages/dashboard/AppPasswordsPage.tsx"),
  "AppPasswordsPage",
);
const SessionsPage = page(
  () => import("./pages/dashboard/SessionsPage.tsx"),
  "SessionsPage",
);
const SettingsPage = page(
  () => import("./pages/dashboard/SettingsPage.tsx"),
  "SettingsPage",
);
const SecurityPage = page(
  () => import("./pages/dashboard/SecurityPage.tsx"),
  "SecurityPage",
);
const CommunicationPage = page(
  () => import("./pages/dashboard/CommunicationPage.tsx"),
  "CommunicationPage",
);
const RepositoryPage = page(
  () => import("./pages/dashboard/RepositoryPage.tsx"),
  "RepositoryPage",
);
const InviteCodesPage = page(
  () => import("./pages/dashboard/InviteCodesPage.tsx"),
  "InviteCodesPage",
);
const DidDocumentPage = page(
  () => import("./pages/dashboard/DidDocumentPage.tsx"),
  "DidDocumentPage",
);
const AdminPage = page(
  () => import("./pages/dashboard/AdminPage.tsx"),
  "AdminPage",
);
const DelegationPage = page(
  () => import("./pages/dashboard/DelegationPage.tsx"),
  "DelegationPage",
);
const OAuthCodePage = page(
  () => import("./pages/oauth/OAuthCodePage.tsx"),
  "OAuthCodePage",
);
const OAuthConsentPage = page(
  () => import("./pages/oauth/OAuthConsentPage.tsx"),
  "OAuthConsentPage",
);
const OAuthLoginPage = page(
  () => import("./pages/oauth/OAuthLoginPage.tsx"),
  "OAuthLoginPage",
);
const OAuthAccountsPage = page(
  () => import("./pages/oauth/OAuthMorePages.tsx"),
  "OAuthAccountsPage",
);
const OAuthDelegationPage = page(
  () => import("./pages/oauth/OAuthMorePages.tsx"),
  "OAuthDelegationPage",
);
const OAuthErrorPage = page(
  () => import("./pages/oauth/OAuthMorePages.tsx"),
  "OAuthErrorPage",
);
const OAuthPasskeyPage = page(
  () => import("./pages/oauth/OAuthMorePages.tsx"),
  "OAuthPasskeyPage",
);
const SsoRegisterCompletePage = page(
  () => import("./pages/oauth/SsoRegistrationPages.tsx"),
  "SsoRegisterCompletePage",
);
const SsoRegisterPage = page(
  () => import("./pages/oauth/SsoRegistrationPages.tsx"),
  "SsoRegisterPage",
);

function AccountIndex() {
  const auth = useAuthState();
  if (auth.kind === "loading")
    return (
      <AuthLayout title="Opening your PDS">
        <Loading />
      </AuthLayout>
    );
  return (
    <Navigate
      to={auth.kind === "authenticated" ? "/app/settings" : "/app/login"}
      replace
    />
  );
}

function NotFoundPage() {
  return (
    <AuthLayout title="Page not found">
      <a href="/app/">Return to the account manager</a>
    </AuthLayout>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname]);
  return null;
}

export default function App() {
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void initAuth().then(({ oauthLoginCompleted }) => {
      if (oauthLoginCompleted) navigate("/app/settings", { replace: true });
    });
  }, [navigate]);

  return (
    <>
      <ScrollToTop />
      <Suspense
        fallback={
          <AuthLayout title="Opening page">
            <Loading />
          </AuthLayout>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/app" element={<AccountIndex />} />
          <Route path="/app/login" element={<LoginPage />} />
          <Route path="/app/register" element={<RegisterPage />} />
          <Route path="/app/verify" element={<VerifyPage />} />
          <Route path="/app/act-as" element={<ActAsPage />} />
          <Route path="/app/migrate" element={<MigrationPage />} />
          <Route path="/app/oauth/register" element={<RegisterPage />} />
          <Route
            path="/app/oauth/register-password"
            element={<RegisterPage />}
          />
          <Route path="/app/oauth/register-sso" element={<SsoRegisterPage />} />
          <Route
            path="/app/oauth/sso-register"
            element={<SsoRegisterCompletePage />}
          />
          <Route path="/app/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/app/request-passkey-recovery"
            element={<RequestPasskeyRecoveryPage />}
          />
          <Route path="/app/recover-passkey" element={<RecoverPasskeyPage />} />
          <Route path="/app/oauth/login" element={<OAuthLoginPage />} />
          <Route path="/app/oauth/consent" element={<OAuthConsentPage />} />
          <Route path="/app/oauth/accounts" element={<OAuthAccountsPage />} />
          <Route path="/app/oauth/2fa" element={<OAuthCodePage />} />
          <Route path="/app/oauth/totp" element={<OAuthCodePage />} />
          <Route path="/app/oauth/passkey" element={<OAuthPasskeyPage />} />
          <Route
            path="/app/oauth/delegation"
            element={<OAuthDelegationPage />}
          />
          <Route
            path="/app/oauth/delegation-totp"
            element={<OAuthCodePage />}
          />
          <Route path="/app/oauth/error" element={<OAuthErrorPage />} />

          <Route path="/app" element={<DashboardRoute />}>
            <Route
              path="dashboard"
              element={<Navigate to="/app/settings" replace />}
            />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="app-passwords" element={<AppPasswordsPage />} />
            <Route path="comms" element={<CommunicationPage />} />
            <Route path="repo" element={<RepositoryPage />} />
            <Route path="controllers" element={<DelegationPage />} />
            <Route path="invite-codes" element={<InviteCodesPage />} />
            <Route path="did-document" element={<DidDocumentPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="about" element={<AboutPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
