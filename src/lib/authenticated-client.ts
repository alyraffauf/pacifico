import type {
  AccessToken,
  Did,
  EmailAddress,
  Handle,
  ScopeSet,
} from "./types/branded.ts";
import type { Session } from "./types/api.ts";
import type {
  DelegationAuditEntry,
  DelegationControlledAccount,
  DelegationController,
  DelegationScopePreset,
  SsoLinkedAccount,
} from "./types/api.ts";
import { api, ApiError } from "./api.ts";
import type { Result } from "./types/result.ts";

export interface AuthenticatedClient {
  readonly token: AccessToken;
  readonly session: Session;

  getSsoLinkedAccounts(): Promise<{ accounts: SsoLinkedAccount[] }>;

  listDelegationControllers(): Promise<
    Result<{ controllers: DelegationController[] }, ApiError>
  >;
  listDelegationControlledAccounts(): Promise<
    Result<{ accounts: DelegationControlledAccount[] }, ApiError>
  >;
  getDelegationScopePresets(): Promise<
    Result<{ presets: DelegationScopePreset[] }, ApiError>
  >;
  addDelegationController(
    controllerDid: Did,
    grantedScopes: ScopeSet,
  ): Promise<Result<{ success: boolean }, ApiError>>;
  removeDelegationController(
    controllerDid: Did,
  ): Promise<Result<{ success: boolean }, ApiError>>;
  createDelegatedAccount(
    handle: Handle,
    email?: EmailAddress,
    controllerScopes?: ScopeSet,
  ): Promise<Result<{ did: Did; handle: Handle }, ApiError>>;
  getDelegationAuditLog(
    limit: number,
    offset: number,
  ): Promise<
    Result<{ entries: DelegationAuditEntry[]; total: number }, ApiError>
  >;

}

export function createAuthenticatedClient(
  session: Session,
): AuthenticatedClient {
  const token = session.accessJwt;

  return {
    token,
    session,

    getSsoLinkedAccounts: () => api.getSsoLinkedAccounts(token),

    listDelegationControllers: () => api.listDelegationControllers(token),
    listDelegationControlledAccounts: () =>
      api.listDelegationControlledAccounts(token),
    getDelegationScopePresets: () => api.getDelegationScopePresets(),
    addDelegationController: (controllerDid, grantedScopes) =>
      api.addDelegationController(token, controllerDid, grantedScopes),
    removeDelegationController: (controllerDid) =>
      api.removeDelegationController(token, controllerDid),
    createDelegatedAccount: (handle, email, controllerScopes) =>
      api.createDelegatedAccount(token, handle, email, controllerScopes),
    getDelegationAuditLog: (limit, offset) =>
      api.getDelegationAuditLog(token, limit, offset),
  };
}

export { ApiError };
