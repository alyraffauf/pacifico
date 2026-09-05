export interface AuthorizationResult {
  redirect_uri?: string;
  redirect?: string;
  needs_totp?: boolean;
  needs_2fa?: boolean;
  channel?: string;
}

export type OAuthCodeMode = "channel" | "totp" | "delegation-totp";

export function getAuthorizationDestination(
  result: AuthorizationResult,
  requestUri: string,
): string | null {
  const encodedRequestUri = encodeURIComponent(requestUri);

  if (result.needs_totp) {
    return `/app/oauth/totp?request_uri=${encodedRequestUri}`;
  }
  if (result.needs_2fa) {
    const channel = encodeURIComponent(result.channel || "email");
    return `/app/oauth/2fa?request_uri=${encodedRequestUri}&channel=${channel}`;
  }
  return result.redirect_uri ?? result.redirect ?? null;
}

export function getOAuthCodeMode(pathname: string): OAuthCodeMode {
  if (pathname.endsWith("/delegation-totp")) return "delegation-totp";
  if (pathname.endsWith("/totp")) return "totp";
  return "channel";
}

export function getOAuthCodeEndpoint(mode: OAuthCodeMode): string {
  return mode === "delegation-totp"
    ? "/oauth/delegation/totp"
    : "/oauth/authorize/2fa";
}
