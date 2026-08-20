import { useEffect, useRef, useState, type FormEvent } from "react";

import type { UpsertWordRequest } from "@huayi/cloud-contracts";

import type { WebWordLibraryApi } from "./word-library-api.js";

type ManualWordApi = Pick<WebWordLibraryApi, "upsertWord">;

function optional(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function ManualWordForm({
  api,
  idempotencyKey,
  onSaved,
}: {
  readonly api: ManualWordApi;
  readonly idempotencyKey: () => string;
  readonly onSaved: (wordId: string) => Promise<boolean>;
}) {
  const [contextualMeaningZh, setContextualMeaningZh] = useState("");
  const [error, setError] = useState("");
  const [headword, setHeadword] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [status, setStatus] = useState("");
  const active = useRef(true);
  const headwordControl = useRef<HTMLInputElement>(null);
  const savingLock = useRef(false);

  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingLock.current) return;
    savingLock.current = true;
    setError("");
    setStatus("");
    const source = optional(sourceText);
    const meaning = optional(contextualMeaningZh);
    const title = optional(sourceTitle);
    if (title !== undefined && source === undefined && meaning === undefined) {
      setError("填写来源标题时，还需要填写原句或语境释义。草稿已保留。");
      savingLock.current = false;
      return;
    }
    const context =
      source === undefined && meaning === undefined
        ? undefined
        : {
            ...(meaning === undefined ? {} : { contextualMeaningZh: meaning }),
            ...(source === undefined ? {} : { sourceText: source }),
            ...(title === undefined ? {} : { sourceTitle: title }),
          };
    const request: UpsertWordRequest = {
      ...(context === undefined ? {} : { context }),
      headword,
      ...(optional(notes) === undefined ? {} : { notes: optional(notes) }),
    };
    setSaving(true);
    try {
      const response = await api.upsertWord(request, idempotencyKey());
      if (!active.current) return;
      const refreshed = await onSaved(response.word.id);
      if (!active.current) return;
      if (!refreshed) {
        setError("词条已收录，但刷新失败。草稿已保留，可以稍后重新载入。");
        return;
      }
      setStatus(
        response.contextOutcome === "duplicate"
          ? "词条已确认；相同语境未重复添加。"
          : response.wordOutcome === "created"
            ? "词条已收录，并已重新读取服务器词条。"
            : response.contextOutcome === "created"
              ? "新语境已添加，并已重新读取服务器词条。"
              : "既有词条已确认，并已重新读取服务器词条。",
      );
      setContextualMeaningZh("");
      setHeadword("");
      setNotes("");
      setSourceText("");
      setSourceTitle("");
      headwordControl.current?.focus();
    } catch {
      if (active.current) setError("无法收录词条，草稿已保留。请检查内容或网络后重试。");
    } finally {
      savingLock.current = false;
      if (active.current) setSaving(false);
    }
  };

  return (
    <section aria-labelledby="manual-word-heading" className="manual-word-card">
      <h2 id="manual-word-heading">手动收录生词</h2>
      <p>可只收录词头，也可同时保存一条手动语境；既有词条的备注不会被覆盖。</p>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="manual-word-headword">英文词头或短语</label>
        <input
          id="manual-word-headword"
          maxLength={200}
          name="headword"
          onChange={(event) => setHeadword(event.currentTarget.value)}
          ref={headwordControl}
          required
          value={headword}
        />
        <label htmlFor="manual-word-notes">备注（仅新词创建时采用）</label>
        <textarea
          id="manual-word-notes"
          maxLength={4_000}
          name="newWordNotes"
          onChange={(event) => setNotes(event.currentTarget.value)}
          value={notes}
        />
        <fieldset>
          <legend>可选手动语境</legend>
          <label htmlFor="manual-word-source">英文原句</label>
          <textarea
            id="manual-word-source"
            maxLength={2_000}
            name="sourceText"
            onChange={(event) => setSourceText(event.currentTarget.value)}
            value={sourceText}
          />
          <label htmlFor="manual-word-meaning">语境释义</label>
          <textarea
            id="manual-word-meaning"
            maxLength={2_000}
            name="contextualMeaningZh"
            onChange={(event) => setContextualMeaningZh(event.currentTarget.value)}
            value={contextualMeaningZh}
          />
          <label htmlFor="manual-word-title">来源标题</label>
          <input
            id="manual-word-title"
            maxLength={500}
            name="sourceTitle"
            onChange={(event) => setSourceTitle(event.currentTarget.value)}
            value={sourceTitle}
          />
        </fieldset>
        <button disabled={saving} type="submit">
          {saving ? "正在收录…" : "收录词条"}
        </button>
      </form>
      {error !== "" && <p role="alert">{error}</p>}
      <p aria-atomic="true" aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}
