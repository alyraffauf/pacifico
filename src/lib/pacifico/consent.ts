export interface ConsentScope {
  scope: string;
  category: string;
  required: boolean;
  description: string;
  display_name: string;
  granted: boolean | null;
  restricted?: boolean;
  superseded?: boolean;
  effective_scope?: string;
}

export interface ConsentPermissionSet {
  nsid?: string;
  aud?: string;
  include_scope: string;
  title?: string;
  detail?: string;
  expanded?: ConsentScope[];
  granted: boolean | null;
  restricted?: boolean;
  superseded?: boolean;
}

export interface ConsentData {
  request_uri: string;
  client_id?: string;
  client_name: string | null;
  client_uri: string | null;
  logo_uri?: string | null;
  scopes: ConsentScope[];
  permission_sets?: ConsentPermissionSet[];
  failed_sets?: Array<{ nsid: string; aud?: string; reason: string }>;
  transition_supersedes?: boolean;
  show_consent: boolean;
  did?: string;
  handle?: string;
  is_delegation?: boolean;
  controller_did?: string;
  controller_handle?: string;
  delegation_level?: string;
}

export const transitionScope = "transition:generic";

export function initialConsentSelections(
  consent: ConsentData,
): Record<string, boolean> {
  return Object.fromEntries([
    ...consent.scopes
      .filter((scope) => !scope.restricted)
      .map(
        (scope) =>
          [scope.scope, scope.required || scope.granted !== false] as const,
      ),
    ...(consent.permission_sets ?? [])
      .filter((permissionSet) => !permissionSet.restricted)
      .map(
        (permissionSet) =>
          [
            permissionSet.include_scope,
            permissionSet.granted !== false,
          ] as const,
      ),
  ]);
}

export function updateConsentSelection(
  consent: ConsentData,
  current: Record<string, boolean>,
  scope: string,
  selected: boolean,
): Record<string, boolean> {
  const next = { ...current, [scope]: selected };
  if (scope !== transitionScope || !selected || !consent.transition_supersedes)
    return next;

  for (const item of [...consent.scopes, ...(consent.permission_sets ?? [])]) {
    if (item.superseded && !item.restricted) {
      const key = "scope" in item ? item.scope : item.include_scope;
      next[key] = true;
    }
  }
  return next;
}

export function approvedConsentScopes(
  consent: ConsentData,
  selections: Record<string, boolean>,
): string[] {
  const approvedScopes = Object.keys(selections).filter(
    (scope) => selections[scope],
  );
  if (
    approvedScopes.length === 0 &&
    consent.scopes.length === 0 &&
    (consent.permission_sets?.length ?? 0) === 0
  ) {
    return ["atproto"];
  }
  return approvedScopes;
}

export type ExpandedPermissions = {
  repository: Array<{
    collection: string;
    create: boolean;
    update: boolean;
    delete: boolean;
  }>;
  rpc: string[];
  other: ConsentScope[];
};

export function describeExpandedPermissions(
  expanded: ConsentScope[],
): ExpandedPermissions {
  const repository = new Map<
    string,
    ExpandedPermissions["repository"][number]
  >();
  const rpc: string[] = [];
  const other: ConsentScope[] = [];

  for (const scope of expanded) {
    const [base, query = ""] = (scope.effective_scope ?? scope.scope).split(
      "?",
    );
    const parameters = new URLSearchParams(query);
    if (base.startsWith("repo:")) {
      const collection = base.slice("repo:".length) || "*";
      const requestedActions = parameters.getAll("action");
      const actions =
        requestedActions.length > 0
          ? requestedActions
          : ["create", "update", "delete"];
      const row = repository.get(collection) ?? {
        collection,
        create: false,
        update: false,
        delete: false,
      };
      for (const action of actions) {
        if (action === "create" || action === "update" || action === "delete")
          row[action] = true;
      }
      repository.set(collection, row);
    } else if (base.startsWith("rpc:")) {
      rpc.push(base.slice("rpc:".length));
    } else {
      other.push(scope);
    }
  }

  return { repository: [...repository.values()], rpc, other };
}

export function scopeLabel(scope: string): string {
  const [base, query = ""] = scope.split("?");
  if (base.startsWith("repo:")) {
    const actions = new URLSearchParams(query).getAll("action");
    const collection = base.slice("repo:".length) || "*";
    return actions.length > 0
      ? `${collection} (${actions.join(", ")})`
      : collection;
  }
  return base.startsWith("rpc:") ? base.slice("rpc:".length) : base;
}
