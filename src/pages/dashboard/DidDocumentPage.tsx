import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  DashboardPage,
  SettingsContent,
  SettingsItem,
  SettingsSection,
  Textarea,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api, ApiError } from "../../lib/api.ts";
import { useTranslation } from "../../lib/i18n.ts";
import type { DidDocument } from "../../lib/types/api.ts";

export function DidDocumentPage() {
  const t = useTranslation();
  const session = useSession();
  const loadDocument = useCallback(
    () => api.getDidDocument(session.accessJwt),
    [session.accessJwt],
  );
  const document = useAsync(loadDocument);
  const [source, setSource] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const documentSource =
    source ?? (document.data ? JSON.stringify(document.data, null, 2) : "");

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const next = JSON.parse(documentSource) as DidDocument;
      const atprotoService = next.service.find((service) =>
        service.id.endsWith("#atproto_pds"),
      );
      await api.updateDidDocument(session.accessJwt, {
        alsoKnownAs: next.alsoKnownAs,
        verificationMethods: next.verificationMethod,
        serviceEndpoint: atprotoService?.serviceEndpoint,
      });
      setMessage({ tone: "success", text: t("didEditor.success") });
      await document.reload();
      setSource(null);
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof ApiError || caught instanceof Error
            ? caught.message
            : t("didEditor.saveFailed"),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardPage
      title={t("dashboard.navDidDocument")}
      description={t("didEditor.helpText")}
      actions={
        <Button
          onClick={() => void save()}
          disabled={saving || !documentSource}
        >
          {saving ? t("common.saving") : t("didEditor.save")}
        </Button>
      }
      busy={document.loading && !document.data}
    >
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {document.error ? <Alert tone="error">{document.error}</Alert> : null}
      <SettingsSection title={t("didEditor.preview")}>
        {document.loading && !document.data ? (
          <SettingsItem title={t("common.loading")} />
        ) : document.data ? (
          <SettingsContent>
            <Textarea
              value={documentSource}
              onChange={(event) => setSource(event.target.value)}
              className="min-h-[32rem] bg-ctp-crust"
              spellCheck={false}
              aria-label={t("didEditor.preview")}
            />
          </SettingsContent>
        ) : (
          <SettingsItem title={t("didEditor.loadFailed")} />
        )}
      </SettingsSection>
    </DashboardPage>
  );
}
