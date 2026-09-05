import { setSession } from "../auth.ts";

export interface SsoRegistrationSession {
  did: string;
  handle: string;
  accessJwt?: string;
  refreshJwt?: string;
}

export function persistSsoRegistrationSession(result: SsoRegistrationSession): boolean {
  if (!result.accessJwt || !result.refreshJwt) return false;
  setSession({
    did: result.did,
    handle: result.handle,
    accessJwt: result.accessJwt,
    refreshJwt: result.refreshJwt,
  });
  return true;
}
