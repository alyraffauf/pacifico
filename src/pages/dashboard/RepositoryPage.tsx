import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loading,
  PageHeading,
  Select,
  Textarea,
} from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useSession } from "../../hooks/useSession.ts";
import { api, ApiError } from "../../lib/api.ts";
import { unsafeAsNsid, unsafeAsRkey } from "../../lib/types/branded.ts";
import type { RecordInfo } from "../../lib/types/api.ts";

type Editor = {
  mode: "create" | "edit";
  collection: string;
  rkey: string;
  json: string;
  record?: RecordInfo;
};

export function RepositoryPage() {
  const session = useSession();
  const repository = useAsync(
    () => api.describeRepo(session.accessJwt, session.did),
    [session.accessJwt, session.did],
  );
  const [collection, setCollection] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [records, setRecords] = useState<RecordInfo[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  async function loadRecords(nextCollection: string, nextCursor?: string) {
    if (!nextCollection) return;
    setLoadingRecords(true);
    setNotice(null);
    try {
      const result = await api.listRecords(
        session.accessJwt,
        session.did,
        unsafeAsNsid(nextCollection),
        { limit: 50, cursor: nextCursor },
      );
      setRecords((current) =>
        nextCursor ? [...current, ...result.records] : result.records,
      );
      setCursor(result.cursor);
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "Could not load records.",
      });
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    const first = repository.data?.collections[0];
    if (!collection && first) {
      setCollection(first);
      void loadRecords(first);
    }
  }, [repository.data]);

  function startCreate() {
    const target = collection || "app.bsky.feed.post";
    const example =
      target === "app.bsky.feed.post"
        ? { $type: target, text: "", createdAt: new Date().toISOString() }
        : { $type: target };
    setEditor({
      mode: "create",
      collection: target,
      rkey: "",
      json: JSON.stringify(example, null, 2),
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    let value: unknown;
    try {
      value = JSON.parse(editor.json);
    } catch (caught) {
      setNotice({
        tone: "error",
        text: caught instanceof Error ? caught.message : "Invalid JSON.",
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      if (editor.mode === "create")
        await api.createRecord(
          session.accessJwt,
          session.did,
          unsafeAsNsid(editor.collection.trim()),
          value,
          editor.rkey.trim() ? unsafeAsRkey(editor.rkey.trim()) : undefined,
        );
      else
        await api.putRecord(
          session.accessJwt,
          session.did,
          unsafeAsNsid(editor.collection),
          unsafeAsRkey(editor.rkey),
          value,
        );
      setCollection(editor.collection);
      setEditor(null);
      await repository.reload();
      await loadRecords(editor.collection);
      setNotice({
        tone: "success",
        text: editor.mode === "create" ? "Record created." : "Record saved.",
      });
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "Could not save the record.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editor || editor.mode !== "edit" || !confirm(`Delete ${editor.rkey}?`))
      return;
    setBusy(true);
    try {
      await api.deleteRecord(
        session.accessJwt,
        session.did,
        unsafeAsNsid(editor.collection),
        unsafeAsRkey(editor.rkey),
      );
      setEditor(null);
      await loadRecords(editor.collection);
      setNotice({ tone: "success", text: "Record deleted." });
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "Could not delete the record.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function downloadCar() {
    setBusy(true);
    try {
      const data = await api.getRepo(session.accessJwt, session.did);
      const url = URL.createObjectURL(
        new Blob([data], { type: "application/vnd.ipld.car" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${session.handle}.car`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof ApiError
            ? caught.message
            : "Could not export the repository.",
      });
    } finally {
      setBusy(false);
    }
  }

  const collections =
    repository.data?.collections.filter((item) =>
      item.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];
  return (
    <div className="grid gap-6">
      <PageHeading
        title="Repository"
        description="Browse and edit the records stored in your AT Protocol repository."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void downloadCar()}
            >
              Download CAR
            </Button>
            <Button onClick={startCreate}>New record</Button>
          </>
        }
      />
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {repository.error ? <Alert tone="error">{repository.error}</Alert> : null}
      {repository.loading ? (
        <Loading label="Loading repository" />
      ) : repository.data ? (
        <>
          <Card className="p-5">
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
              <Field label="Filter collections">
                <Input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="app.bsky"
                />
              </Field>
              <Field label="Collection">
                <Select
                  value={collection}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCollection(next);
                    setEditor(null);
                    void loadRecords(next);
                  }}
                >
                  {collections.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="self-end pb-2 font-mono text-xs text-ctp-overlay-1">
                {repository.data.collections.length} collections
              </div>
            </div>
          </Card>
          {editor ? (
            <Card className="p-5">
              <form className="grid gap-4" onSubmit={save}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-mono font-semibold text-ctp-text">
                    {editor.mode === "create" ? "New record" : editor.rkey}
                  </h2>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setEditor(null)}
                  >
                    Close
                  </Button>
                </div>
                {editor.mode === "create" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Collection">
                      <Input
                        value={editor.collection}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            collection: event.target.value,
                          })
                        }
                        required
                      />
                    </Field>
                    <Field
                      label="Record key"
                      hint="Leave blank to generate one"
                    >
                      <Input
                        value={editor.rkey}
                        onChange={(event) =>
                          setEditor({ ...editor, rkey: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                ) : (
                  <p className="font-mono text-xs break-all text-ctp-blue">
                    {editor.record?.uri}
                  </p>
                )}
                <Field label="Record JSON">
                  <Textarea
                    className="min-h-[28rem] bg-ctp-crust"
                    value={editor.json}
                    onChange={(event) =>
                      setEditor({ ...editor, json: event.target.value })
                    }
                    spellCheck={false}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy}>{busy ? "Saving" : "Save"}</Button>
                  {editor.mode === "edit" ? (
                    <Button
                      type="button"
                      variant="danger"
                      disabled={busy}
                      onClick={() => void remove()}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </form>
            </Card>
          ) : (
            <>
              {loadingRecords && records.length === 0 ? (
                <Loading label="Loading records" />
              ) : records.length === 0 ? (
                <EmptyState>This collection is empty.</EmptyState>
              ) : (
                <div className="grid gap-3">
                  {records.map((record) => {
                    const rkey = String(record.uri).split("/").pop() ?? "";
                    return (
                      <Card key={record.uri} className="p-4">
                        <button
                          className="w-full text-left"
                          onClick={() =>
                            setEditor({
                              mode: "edit",
                              collection,
                              rkey,
                              json: JSON.stringify(record.value, null, 2),
                              record,
                            })
                          }
                        >
                          <p className="font-mono text-xs break-all text-ctp-blue">
                            {record.uri}
                          </p>
                          <pre className="code-block mt-3 max-h-40">
                            {JSON.stringify(record.value, null, 2)}
                          </pre>
                        </button>
                      </Card>
                    );
                  })}
                </div>
              )}
              {cursor ? (
                <Button
                  variant="secondary"
                  className="justify-self-center"
                  disabled={loadingRecords}
                  onClick={() => void loadRecords(collection, cursor)}
                >
                  {loadingRecords ? "Loading" : "Load more"}
                </Button>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
