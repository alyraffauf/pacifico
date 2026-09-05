import { useMemo } from "react";
import {
  unsafeAsAccessToken,
  unsafeAsDid,
  unsafeAsEmail,
  unsafeAsHandle,
  unsafeAsInviteCode,
  unsafeAsISODate,
  unsafeAsRefreshToken,
} from "../../lib/types/branded.ts";
import type { InviteCodeInfo, Session } from "../../lib/types/api.ts";
import {
  InviteCodesPage,
  type InviteCodesPageApi,
} from "../dashboard/InviteCodesPage.tsx";
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
  isAdmin: true,
};

function createPreviewApi(): InviteCodesPageApi {
  let nextCode = 4;
  let codes: InviteCodeInfo[] = [
    {
      code: unsafeAsInviteCode("pacifico-preview-available"),
      available: 1,
      disabled: false,
      forAccount: previewAccountDid,
      createdBy: previewAccountDid,
      createdAt: unsafeAsISODate("2026-09-01T14:30:00.000Z"),
      uses: [],
    },
    {
      code: unsafeAsInviteCode("pacifico-preview-used"),
      available: 0,
      disabled: false,
      forAccount: previewAccountDid,
      createdBy: previewAccountDid,
      createdAt: unsafeAsISODate("2026-08-24T09:15:00.000Z"),
      uses: [
        {
          usedBy: unsafeAsDid("did:plc:previewinvitee"),
          usedByHandle: unsafeAsHandle("bob.pacifico.test"),
          usedAt: unsafeAsISODate("2026-08-25T18:20:00.000Z"),
        },
      ],
    },
    {
      code: unsafeAsInviteCode("pacifico-preview-disabled"),
      available: 1,
      disabled: true,
      forAccount: previewAccountDid,
      createdBy: previewAccountDid,
      createdAt: unsafeAsISODate("2026-08-12T16:45:00.000Z"),
      uses: [],
    },
  ];

  return {
    async getAccountInviteCodes() {
      return { codes };
    },
    async createInviteCode() {
      const code = `pacifico-preview-new-${nextCode++}`;
      codes = [
        {
          code: unsafeAsInviteCode(code),
          available: 1,
          disabled: false,
          forAccount: previewAccountDid,
          createdBy: previewAccountDid,
          createdAt: unsafeAsISODate(new Date().toISOString()),
          uses: [],
        },
        ...codes,
      ];
      return { code };
    },
    async disableInviteCodes(_token, disabledCodes = []) {
      codes = codes.map((inviteCode) =>
        disabledCodes.includes(inviteCode.code)
          ? { ...inviteCode, disabled: true }
          : inviteCode,
      );
    },
  };
}

export function InviteCodesPreviewPage() {
  const apiClient = useMemo(() => createPreviewApi(), []);

  return (
    <DashboardPreview path="/app/dev/invite-codes" session={previewSession}>
      <InviteCodesPage apiClient={apiClient} />
    </DashboardPreview>
  );
}
