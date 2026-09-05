import { useMemo } from "react";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsISODate,
  unsafeAsRefreshToken,
  unsafeAsScopeSet,
} from "../../lib/types/branded.ts";
import type {
  DelegationAuditEntry,
  DelegationControlledAccount,
  DelegationController,
  Session,
} from "../../lib/types/api.ts";
import { ok } from "../../lib/types/result.ts";
import {
  DelegationPage,
  type DelegationPageApi,
} from "../dashboard/DelegationPage.tsx";
import { DashboardPreview } from "./DashboardPreview.tsx";

const previewAccountDid = unsafeAsDid("did:plc:previewaccount");
const previewSession: Session = {
  did: previewAccountDid,
  handle: unsafeAsHandle("alice.pacifico.test"),
  accessJwt: unsafeAsAccessToken("preview-access-token"),
  refreshJwt: unsafeAsRefreshToken("preview-refresh-token"),
  contactKind: "email",
  email: unsafeAsEmail("alice@example.com"),
  emailConfirmed: true,
  accountKind: "active",
  isAdmin: false,
};

function createPreviewApi(): DelegationPageApi {
  let nextAccount = 2;
  let controllers: DelegationController[] = [];
  let accounts: DelegationControlledAccount[] = [
    {
      did: unsafeAsDid("did:plc:previewmanagedaccount"),
      handle: unsafeAsHandle("studio.pacifico.test"),
      grantedScopes: unsafeAsScopeSet("owner"),
      grantedAt: unsafeAsISODate("2026-08-20T14:30:00.000Z"),
    },
  ];
  const audit: DelegationAuditEntry[] = [
    {
      id: "audit-1",
      action: "account.created",
      actor_did: previewAccountDid,
      target_did: unsafeAsDid("did:plc:previewmanagedaccount"),
      details: "Created managed account @studio.pacifico.test",
      created_at: unsafeAsISODate("2026-08-20T14:30:00.000Z"),
    },
    {
      id: "audit-2",
      action: "controller.updated",
      actor_did: previewAccountDid,
      target_did: unsafeAsDid("did:plc:previewmanagedaccount"),
      details: "Changed delegated access to owner",
      created_at: unsafeAsISODate("2026-08-22T09:15:00.000Z"),
    },
  ];

  return {
    async listDelegationControllers() {
      return ok({ controllers });
    },
    async listDelegationControlledAccounts() {
      return ok({ accounts });
    },
    async getDelegationScopePresets() {
      return ok({
        presets: [
          {
            name: "owner",
            scopes: unsafeAsScopeSet("owner"),
            description: "Manage settings and content",
          },
          {
            name: "editor",
            scopes: unsafeAsScopeSet("editor"),
            description: "Create and edit content",
          },
          {
            name: "viewer",
            scopes: unsafeAsScopeSet("viewer"),
            description: "View account data",
          },
        ],
      });
    },
    async getDelegationAuditLog() {
      return ok({ entries: audit, total: audit.length });
    },
    async resolveController(identifier) {
      return ok({
        did: "did:plc:previewcontroller",
        handle: identifier.includes(".")
          ? identifier
          : `${identifier}.pacifico.test`,
        pdsUrl: "https://pacifico.test",
        isLocal: true,
      });
    },
    async addDelegationController(_token, controllerDid, grantedScopes) {
      controllers = [
        ...controllers,
        {
          did: controllerDid,
          handle: unsafeAsHandle("bob.pacifico.test"),
          grantedScopes,
          grantedAt: unsafeAsISODate(new Date().toISOString()),
          isActive: true,
          isLocal: true,
        },
      ];
      return ok({ success: true });
    },
    async removeDelegationController(_token, controllerDid) {
      controllers = controllers.filter(
        (controller) => controller.did !== controllerDid,
      );
      return ok({ success: true });
    },
    async createDelegatedAccount(_token, handle, _email, controllerScopes) {
      const did = unsafeAsDid(`did:plc:previewmanaged${nextAccount++}`);
      accounts = [
        ...accounts,
        {
          did,
          handle,
          grantedScopes: controllerScopes ?? unsafeAsScopeSet("owner"),
          grantedAt: unsafeAsISODate(new Date().toISOString()),
        },
      ];
      return ok({ did, handle });
    },
  };
}

export function DelegationPreviewPage() {
  const apiClient = useMemo(() => createPreviewApi(), []);

  return (
    <DashboardPreview path="/app/dev/delegation" session={previewSession}>
      <DelegationPage apiClient={apiClient} />
    </DashboardPreview>
  );
}
