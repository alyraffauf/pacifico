import { useEffect, useMemo, useState } from "react";
import { readJson, requestParameter } from "../../lib/http.ts";
import {
  approvedConsentScopes,
  initialConsentSelections,
  transitionScope,
  updateConsentSelection,
  type ConsentData,
} from "../../lib/pacifico/consent.ts";
import { denyAuthorization } from "../../lib/pacifico/oauth-denial.ts";
import { useTranslation } from "../../lib/i18n.ts";
import { OAuthConsentView, groupConsentScopes } from "./OAuthConsentViews.tsx";

async function fetchConsent(requestUri: string): Promise<ConsentData> {
  const url = `/oauth/authorize/consent?request_uri=${encodeURIComponent(requestUri)}`;
  let response = await fetch(url);

  if (!response.ok) {
    const error = (await response
      .clone()
      .json()
      .catch(() => ({}))) as { error?: string };
    if (error.error === "expired_request") {
      const renewal = await fetch("/oauth/authorize/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_uri: requestUri }),
      });
      const renewalResult = await readJson<{ renewed?: boolean }>(renewal);
      if (renewalResult.renewed) response = await fetch(url);
    }
  }

  return readJson<ConsentData>(response);
}

async function authorize(
  consent: ConsentData,
  selections: Record<string, boolean>,
  remember: boolean,
): Promise<string> {
  const approvedScopes = approvedConsentScopes(consent, selections);

  const result = await readJson<{ redirect_uri?: string }>(
    await fetch("/oauth/authorize/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_uri: consent.request_uri,
        approved_scopes: approvedScopes,
        remember,
      }),
    }),
  );

  if (!result.redirect_uri)
    throw new Error("The authorization server returned no redirect.");
  return result.redirect_uri;
}

export function OAuthConsentPage() {
  const t = useTranslation();
  const requestUri = requestParameter("request_uri");
  const [consent, setConsent] = useState<ConsentData | null>(null);
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(Boolean(requestUri));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    requestUri ? null : "The authorization request is missing.",
  );

  useEffect(() => {
    let active = true;
    if (!requestUri) {
      return () => {
        active = false;
      };
    }

    void fetchConsent(requestUri)
      .then(async (data) => {
        if (!active) return;
        const nextSelections = initialConsentSelections(data);
        setConsent(data);
        setSelections(nextSelections);
        if (!data.show_consent) {
          setSubmitting(true);
          globalThis.location.assign(
            await authorize(data, nextSelections, false),
          );
        }
      })
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load permissions.",
          );
          setSubmitting(false);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [requestUri]);

  const groupedScopes = useMemo(
    () =>
      groupConsentScopes(
        (consent?.scopes ?? []).filter((scope) => !scope.restricted),
      ),
    [consent],
  );
  const approvableSets =
    consent?.permission_sets?.filter(
      (permissionSet) => !permissionSet.restricted,
    ) ?? [];
  const restrictedScopes =
    consent?.scopes.filter((scope) => scope.restricted) ?? [];
  const limitedSets =
    consent?.permission_sets?.filter((permissionSet) =>
      permissionSet.expanded?.some((scope) => scope.restricted),
    ) ?? [];
  const failedSets = consent?.failed_sets ?? [];
  const transitionSelected = selections[transitionScope] === true;
  const anyDeselected = Object.values(selections).some((selected) => !selected);

  function isSuperseded(item: { superseded?: boolean }): boolean {
    return Boolean(
      consent?.transition_supersedes &&
      item.superseded &&
      selections[transitionScope],
    );
  }

  function toggleScope(scope: string, selected: boolean) {
    if (!consent) return;
    setSelections((current) =>
      updateConsentSelection(consent, current, scope, selected),
    );
  }

  async function approve() {
    if (!consent) return;
    setSubmitting(true);
    setError(null);
    try {
      globalThis.location.assign(
        await authorize(consent, selections, remember),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not approve access.",
      );
      setSubmitting(false);
    }
  }

  async function deny() {
    if (!consent) return;
    setSubmitting(true);
    setError(null);
    try {
      globalThis.location.assign(await denyAuthorization(consent.request_uri));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not deny access.",
      );
      setSubmitting(false);
    }
  }

  return (
    <OAuthConsentView
      consent={consent}
      selections={selections}
      remember={remember}
      setRemember={setRemember}
      loading={loading}
      submitting={submitting}
      error={error}
      groupedScopes={groupedScopes}
      approvableSets={approvableSets}
      restrictedScopes={restrictedScopes}
      limitedSets={limitedSets}
      failedSets={failedSets}
      transitionSelected={transitionSelected}
      anyDeselected={anyDeselected}
      isSuperseded={isSuperseded}
      toggleScope={toggleScope}
      approve={approve}
      deny={deny}
      t={t}
    />
  );
}
