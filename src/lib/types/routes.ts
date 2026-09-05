export const routes = {
  login: "/login",
  dashboard: "/dashboard",
  settings: "/settings",
  security: "/security",
  sessions: "/sessions",
  appPasswords: "/app-passwords",
  inviteCodes: "/invite-codes",
  comms: "/comms",
  repo: "/repo",
  controllers: "/controllers",

  actAs: "/act-as",
  didDocument: "/did-document",
  migrate: "/migrate",
  admin: "/admin",
  about: "/about",
  verify: "/verify",
  resetPassword: "/reset-password",
  recoverPasskey: "/recover-passkey",
  requestPasskeyRecovery: "/request-passkey-recovery",
  oauthLogin: "/oauth/login",
  oauthConsent: "/oauth/consent",
  oauthAccounts: "/oauth/accounts",
  oauth2fa: "/oauth/2fa",
  oauthTotp: "/oauth/totp",
  oauthPasskey: "/oauth/passkey",
  oauthDelegation: "/oauth/delegation",
  oauthError: "/oauth/error",
  oauthSsoRegister: "/oauth/sso-register",
  oauthRegister: "/oauth/register",
  oauthRegisterSso: "/oauth/register-sso",
  oauthRegisterPassword: "/oauth/register-password",
} as const;

export type Route = (typeof routes)[keyof typeof routes];

export type RouteKey = keyof typeof routes;

export function isValidRoute(path: string): path is Route {
  return Object.values(routes).includes(path as Route);
}

export interface RouteParams {
  [routes.verify]: { token?: string; email?: string };
  [routes.resetPassword]: { token?: string };
  [routes.recoverPasskey]: { token?: string; did?: string };
  [routes.oauthLogin]: { request_uri?: string; error?: string };
  [routes.oauthConsent]: { request_uri?: string; client_id?: string };
  [routes.oauthAccounts]: { request_uri?: string };
  [routes.oauth2fa]: { request_uri?: string; channel?: string };
  [routes.oauthTotp]: { request_uri?: string };
  [routes.oauthPasskey]: { request_uri?: string };
  [routes.oauthDelegation]: { request_uri?: string; delegated_did?: string };
  [routes.oauthError]: { error?: string; error_description?: string };
  [routes.migrate]: { code?: string; state?: string };
  [routes.oauthSsoRegister]: { token?: string };
  [routes.oauthRegister]: { request_uri?: string };
  [routes.oauthRegisterSso]: { request_uri?: string };
  [routes.oauthRegisterPassword]: { request_uri?: string };
}

export type RoutesWithParams = keyof RouteParams;

export function buildUrl<R extends Route>(
  route: R,
  params?: R extends RoutesWithParams ? RouteParams[R] : never,
): string {
  if (!params) return route;
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      searchParams.set(key, String(value));
    }
  }
  const queryString = searchParams.toString();
  return queryString ? `${route}?${queryString}` : route;
}

export function parseRouteParams<R extends RoutesWithParams>(
  _route: R,
): RouteParams[R] {
  const params = new URLSearchParams(globalThis.location.search);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result as RouteParams[R];
}
