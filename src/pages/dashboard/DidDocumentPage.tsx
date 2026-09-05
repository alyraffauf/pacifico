import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Loading,
  PageHeading,
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
  const document = useAsync(
    () => api.getDidDocument(session.accessJwt),
    [session.accessJwt],
  );
  const [source, setSource] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (document.data) setSource(JSON.stringify(document.data, null, 2));
  }, [document.data]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const next = JSON.parse(source) as DidDocument;
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
    <div className="grid gap-6">
      <PageHeading
        title={t("dashboard.navDidDocument")}
        description={t("didEditor.helpText")}
        actions={
          <Button onClick={() => void save()} disabled={saving || !source}>
            {saving ? t("common.saving") : t("didEditor.save")}
          </Button>
        }
      />
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {document.error ? <Alert tone="error">{document.error}</Alert> : null}
      {document.loading ? (
        <Loading />
      ) : (
        <Card className="p-4">
          <Textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="min-h-[32rem] border-0 bg-ctp-crust"
            spellCheck={false}
            aria-label="DID document JSON"
          />
        </Card>
      )}
    </div>
  );
}
