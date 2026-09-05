import type { Dispatch, SetStateAction } from "react";
import { AuthLayout } from "../../components/AuthLayout.tsx";
import {
  Alert,
  Button,
  Card,
  DataTable,
  Loading,
} from "../../components/ui.tsx";
import {
  describeExpandedPermissions,
  scopeLabel,
  type ConsentData,
  type ConsentPermissionSet,
  type ConsentScope,
} from "../../lib/pacifico/consent.ts";
import type { useTranslation } from "../../lib/i18n.ts";

const categoryOrder = [
  "Core Access",
  "Transition",
  "Account",
  "Repository",
  "Media",
  "API Access",
  "Reference",
  "Other",
];
const knownFailureReasons = new Set([
  "unreachable",
  "not_found",
  "malformed",
  "not_a_permission_set",
  "malformed_lexicon",
  "empty_permissions",
]);

function failureReasonKey(reason: string): string {
  return `oauth.consent.setFailureReason.${knownFailureReasons.has(reason) ? reason : "unknown"}`;
}

export function groupConsentScopes(
  scopes: ConsentScope[],
): Array<[string, ConsentScope[]]> {
  const groups = new Map<string, ConsentScope[]>();
  for (const scope of scopes)
    groups.set(scope.category, [...(groups.get(scope.category) ?? []), scope]);
  return [...groups.entries()].sort(([left], [right]) => {
    const leftIndex = categoryOrder.indexOf(left);
    const rightIndex = categoryOrder.indexOf(right);
    return (
      (leftIndex < 0 ? categoryOrder.length : leftIndex) -
      (rightIndex < 0 ? categoryOrder.length : rightIndex)
    );
  });
}

export function PermissionDetails({
  permissionSet,
  t,
}: {
  permissionSet: ConsentPermissionSet;
  t: ReturnType<typeof useTranslation>;
}) {
  const allowed = (permissionSet.expanded ?? []).filter(
    (scope) => !scope.restricted,
  );
  const details = describeExpandedPermissions(allowed);
  return (
    <details className="mt-3 text-xs text-ctp-subtext0">
      <summary className="cursor-pointer text-ctp-blue">
        {t("oauth.consent.showIncludedScopes", { count: allowed.length })}
      </summary>
      {details.repository.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <DataTable className="text-xs">
            <thead>
              <tr>
                <th>{t("oauth.consent.permTable.data")}</th>
                <th>{t("oauth.consent.permTable.create")}</th>
                <th>{t("oauth.consent.permTable.update")}</th>
                <th>{t("oauth.consent.permTable.delete")}</th>
              </tr>
            </thead>
            <tbody>
              {details.repository.map((row) => (
                <tr key={row.collection}>
                  <td className="font-mono">
                    {row.collection === "*"
                      ? t("oauth.consent.permTable.allData")
                      : row.collection}
                  </td>
                  <td>{row.create ? "✓" : ""}</td>
                  <td>{row.update ? "✓" : ""}</td>
                  <td>{row.delete ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      ) : null}
      {details.rpc.length > 0 ? (
        <div className="mt-3">
          <p className="font-semibold">
            {t("oauth.consent.permTable.apiAccess")}
          </p>
          <ul className="mt-1 grid gap-1">
            {details.rpc.map((rpc) => (
              <li className="font-mono break-all" key={rpc}>
                {rpc}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {details.other.length > 0 ? (
        <ul className="mt-3 grid gap-1">
          {details.other.map((scope) => (
            <li key={scope.scope}>
              {scope.display_name}{" "}
              <code className="break-all text-ctp-overlay1">{scope.scope}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

export function OAuthConsentView({
  consent,
  selections,
  remember,
  setRemember,
  loading,
  submitting,
  error,
  groupedScopes,
  approvableSets,
  restrictedScopes,
  limitedSets,
  failedSets,
  transitionSelected,
  anyDeselected,
  isSuperseded,
  toggleScope,
  approve,
  deny,
  t,
}: {
  consent: ConsentData | null;
  selections: Record<string, boolean>;
  remember: boolean;
  setRemember: Dispatch<SetStateAction<boolean>>;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  groupedScopes: Array<[string, ConsentScope[]]>;
  approvableSets: ConsentPermissionSet[];
  restrictedScopes: ConsentScope[];
  limitedSets: ConsentPermissionSet[];
  failedSets: NonNullable<ConsentData["failed_sets"]>;
  transitionSelected: boolean;
  anyDeselected: boolean;
  isSuperseded: (item: { superseded?: boolean }) => boolean;
  toggleScope: (scope: string, selected: boolean) => void;
  approve: () => Promise<void>;
  deny: () => Promise<void>;
  t: ReturnType<typeof useTranslation>;
}) {
  return (
    <AuthLayout
      title={consent?.client_name || t("oauth.consent.title")}
      description={
        consent
          ? t("oauth.consent.appWantsAccess", {
              app:
                consent.client_name ??
                consent.client_id ??
                t("oauth.consent.title"),
            })
          : undefined
      }
      wide
    >
      {loading || (submitting && consent?.show_consent === false) ? (
        <Loading label="Continuing authorization" />
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {consent?.show_consent ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)]">
          <aside className="grid content-start gap-4">
            {consent.logo_uri ? (
              <img
                className="max-h-20 max-w-40 rounded object-contain"
                src={consent.logo_uri}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : null}
            {consent.client_uri ? (
              <a
                className="text-sm break-all"
                href={consent.client_uri}
                target="_blank"
                rel="noopener noreferrer"
              >
                {consent.client_uri}
              </a>
            ) : null}
            <Card className="grid gap-3 p-4 text-sm">
              {consent.is_delegation ? (
                <>
                  <p className="font-mono text-xs font-semibold text-ctp-mauve uppercase">
                    {t("oauthConsent.delegatedAccess")}
                  </p>
                  <p>
                    <span className="block text-xs text-ctp-overlay1">
                      {t("oauthConsent.actingAs")}
                    </span>
                    <span className="font-mono text-xs break-all">
                      {consent.did}
                    </span>
                  </p>
                  <p>
                    <span className="block text-xs text-ctp-overlay1">
                      {t("oauthConsent.controller")}
                    </span>
                    @{consent.controller_handle || consent.controller_did}
                  </p>
                  <p>
                    <span className="block text-xs text-ctp-overlay1">
                      {t("oauthConsent.accessLevel")}
                    </span>
                    {consent.delegation_level}
                  </p>
                </>
              ) : (
                <>
                  <span className="text-xs text-ctp-overlay1">
                    {t("oauth.consent.signingInAs")}
                  </span>
                  {consent.handle ? <strong>@{consent.handle}</strong> : null}
                  <span className="font-mono text-xs break-all text-ctp-overlay1">
                    {consent.did}
                  </span>
                </>
              )}
            </Card>
            {consent.is_delegation &&
            consent.delegation_level &&
            consent.delegation_level !== "Owner" ? (
              <Alert tone="warning">
                <strong>{t("oauthConsent.permissionsLimited")}</strong>
                <p className="mt-1">
                  {consent.delegation_level === "Viewer"
                    ? t("oauthConsent.viewerLimitedDesc")
                    : consent.delegation_level === "Editor"
                      ? t("oauthConsent.editorLimitedDesc")
                      : t("oauthConsent.permissionsLimitedDesc", {
                          level: consent.delegation_level,
                        })}
                </p>
              </Alert>
            ) : null}
            {transitionSelected ? (
              <Alert tone="warning">
                <strong>{t("oauth.consent.supersedeWarningTitle")}</strong>
                <p className="mt-1">
                  {t(
                    consent.transition_supersedes
                      ? "oauth.consent.supersedeWarningBodyMixed"
                      : "oauth.consent.supersedeWarningBody",
                  )}
                </p>
              </Alert>
            ) : null}
            {anyDeselected ? (
              <Alert tone="warning">
                <strong>{t("oauth.consent.deselectedWarningTitle")}</strong>
                <p className="mt-1">
                  {t("oauth.consent.deselectedWarningBody")}
                </p>
              </Alert>
            ) : null}
          </aside>
          <div className="grid gap-5">
            <h2 className="font-mono text-lg font-semibold text-ctp-text">
              {t("oauth.consent.permissionsRequested")}
            </h2>
            {consent.scopes.length === 0 && approvableSets.length === 0 ? (
              <Alert>
                <strong>{t("oauthConsent.readOnlyAccess")}</strong>
                <p className="mt-1">{t("oauthConsent.readOnlyDesc")}</p>
              </Alert>
            ) : null}
            {groupedScopes.map(([category, scopes]) => (
              <section key={category} className="grid gap-2">
                <h3 className="font-mono text-xs font-semibold tracking-wide text-ctp-overlay1 uppercase">
                  {category}
                </h3>
                {scopes.map((scope) => (
                  <label
                    key={scope.scope}
                    className="flex gap-3 rounded border border-ctp-surface0 bg-ctp-crust p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-ctp-lavender"
                      checked={
                        isSuperseded(scope) || selections[scope.scope] === true
                      }
                      disabled={
                        scope.required || isSuperseded(scope) || submitting
                      }
                      onChange={(event) =>
                        toggleScope(scope.scope, event.target.checked)
                      }
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ctp-text">
                        {scope.display_name || scope.scope}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-ctp-subtext0">
                        {scope.description}
                      </span>
                      {scope.required ? (
                        <span className="mt-2 inline-block rounded bg-ctp-surface0 px-2 py-0.5 text-xs">
                          {t("oauth.consent.required")}
                        </span>
                      ) : null}
                      {isSuperseded(scope) ? (
                        <span className="mt-2 block text-xs text-ctp-yellow">
                          {t("oauth.consent.supersededNote")}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </section>
            ))}
            {approvableSets.length > 0 ? (
              <section className="grid gap-2">
                <h3 className="font-mono text-xs font-semibold tracking-wide text-ctp-overlay1 uppercase">
                  {t("oauth.consent.permissionSets")}
                </h3>
                {approvableSets.map((permissionSet) => (
                  <label
                    key={permissionSet.include_scope}
                    className="flex gap-3 rounded border border-ctp-surface0 bg-ctp-crust p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-ctp-lavender"
                      checked={
                        isSuperseded(permissionSet) ||
                        selections[permissionSet.include_scope] === true
                      }
                      disabled={isSuperseded(permissionSet) || submitting}
                      onChange={(event) =>
                        toggleScope(
                          permissionSet.include_scope,
                          event.target.checked,
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ctp-text">
                        {permissionSet.title ||
                          permissionSet.nsid ||
                          permissionSet.include_scope}
                      </span>
                      {permissionSet.detail ? (
                        <span className="mt-1 block text-xs leading-5 text-ctp-subtext0">
                          {permissionSet.detail}
                        </span>
                      ) : null}
                      {permissionSet.expanded?.some(
                        (scope) => scope.restricted,
                      ) ? (
                        <span className="mt-2 block text-xs text-ctp-yellow">
                          {t("oauth.consent.setPartiallyLimited")}
                        </span>
                      ) : null}
                      <PermissionDetails permissionSet={permissionSet} t={t} />
                    </span>
                  </label>
                ))}
              </section>
            ) : null}
            {restrictedScopes.length > 0 ||
            limitedSets.length > 0 ||
            failedSets.length > 0 ? (
              <section className="grid gap-2 rounded border border-ctp-yellow/40 p-4">
                <h3 className="font-mono text-xs font-semibold tracking-wide text-ctp-yellow uppercase">
                  {t("oauth.consent.unavailablePermissions")}
                </h3>
                {restrictedScopes.map((scope) => (
                  <div key={scope.scope} className="text-sm">
                    <strong>{scope.display_name}</strong>
                    <code className="ml-2 text-xs break-all text-ctp-overlay1">
                      {scopeLabel(scope.scope)}
                    </code>
                  </div>
                ))}
                {limitedSets.flatMap((permissionSet) =>
                  (permissionSet.expanded ?? [])
                    .filter((scope) => scope.restricted)
                    .map((scope) => (
                      <div
                        key={`${permissionSet.nsid}:${scope.scope}`}
                        className="text-sm"
                      >
                        <strong>
                          {permissionSet.title ||
                            permissionSet.nsid ||
                            permissionSet.include_scope}
                        </strong>
                        <code className="ml-2 text-xs break-all text-ctp-overlay1">
                          {scopeLabel(scope.scope)}
                        </code>
                      </div>
                    )),
                )}
                {failedSets.map((failed) => (
                  <div key={`${failed.aud}:${failed.nsid}`} className="text-sm">
                    <strong>
                      {failed.nsid}
                      {failed.aud ? ` (${failed.aud})` : ""}
                    </strong>
                    <span className="ml-2 text-xs text-ctp-subtext0">
                      {t(failureReasonKey(failed.reason))}
                    </span>
                  </div>
                ))}
              </section>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-ctp-subtext0">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="accent-ctp-lavender"
              />{" "}
              {t("oauth.consent.rememberChoiceLabel")}
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => void deny()}
                disabled={submitting}
              >
                {t("oauth.consent.deny")}
              </Button>
              <Button onClick={() => void approve()} disabled={submitting}>
                {submitting
                  ? t("oauth.consent.authorizing")
                  : t("oauth.consent.authorize")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AuthLayout>
  );
}
