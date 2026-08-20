import { useRef, useState, type FormEvent } from "react";

import {
  createLearningItemRequestSchema,
  type CreateLearningItemRequest,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";

import { WebLearningLibraryApiError } from "./learning-library-api.js";

type ManualType = "expression" | "sentence-pattern";

function values(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function slots(value: string) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const separator = entry.indexOf(":");
      return {
        descriptionZh: separator < 0 ? "" : entry.slice(separator + 1).trim(),
        name: separator < 0 ? entry : entry.slice(0, separator).trim(),
      };
    });
}

export function ManualLearningItemForm(props: {
  createLearningItem(
    input: CreateLearningItemRequest,
    idempotencyKey: string,
  ): Promise<LearningItemDetailResponse>;
  idempotencyKey(): string;
  onCreated(view: LearningItemDetailResponse): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [functionZh, setFunctionZh] = useState("");
  const [meaningZh, setMeaningZh] = useState("");
  const [slotText, setSlotText] = useState("");
  const [systemAttributes, setSystemAttributes] = useState("");
  const [tags, setTags] = useState("");
  const [template, setTemplate] = useState("");
  const [text, setText] = useState("");
  const [type, setType] = useState<ManualType>("expression");
  const [usageZh, setUsageZh] = useState("");
  const pendingKey = useRef<string | null>(null);

  const changed = (write: (value: string) => void) => (value: string) => {
    pendingKey.current = null;
    write(value);
  };

  const request = (): CreateLearningItemRequest =>
    createLearningItemRequestSchema.parse({
      content:
        type === "expression"
          ? { meaningZh, text, type: "expression", usageZh }
          : {
              functionZh,
              slots: slots(slotText),
              template,
              type: "sentence_pattern",
              usageZh,
            },
      systemAttributes: values(systemAttributes),
      tags: values(tags),
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    let created = false;
    try {
      const input = request();
      pendingKey.current ??= props.idempotencyKey();
      const response = await props.createLearningItem(input, pendingKey.current);
      created = true;
      await props.onCreated(response);
      pendingKey.current = null;
      setFunctionZh("");
      setMeaningZh("");
      setSlotText("");
      setSystemAttributes("");
      setTags("");
      setTemplate("");
      setText("");
      setUsageZh("");
    } catch (cause) {
      setError(
        created
          ? "已经收录，但暂时无法刷新学习库；草稿已保留，请重新载入确认。"
          : cause instanceof WebLearningLibraryApiError && cause.code === "exact_duplicate"
            ? "学习库中已存在完全相同的内容；草稿已保留，请检查后决定。"
            : "无法收录这条内容；请检查必填项和句型槽位后重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="manual-learning-item">
      <div>
        <p className="eyebrow">MANUAL CAPTURE</p>
        <h2>手动收录</h2>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          类型
          <select
            name="manualType"
            onChange={(event) => {
              pendingKey.current = null;
              setType(event.currentTarget.value as ManualType);
            }}
            value={type}
          >
            <option value="expression">表达</option>
            <option value="sentence-pattern">句型</option>
          </select>
        </label>
        {type === "expression" ? (
          <>
            <label>
              英文表达
              <input
                maxLength={500}
                name="text"
                onChange={(event) => changed(setText)(event.currentTarget.value)}
                required
                value={text}
              />
            </label>
            <label>
              中文含义
              <textarea
                maxLength={4000}
                name="meaningZh"
                onChange={(event) => changed(setMeaningZh)(event.currentTarget.value)}
                required
                value={meaningZh}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              句型模板
              <input
                maxLength={500}
                name="template"
                onChange={(event) => changed(setTemplate)(event.currentTarget.value)}
                placeholder="Although {clause}, ..."
                required
                value={template}
              />
            </label>
            <label>
              中文功能
              <textarea
                maxLength={4000}
                name="functionZh"
                onChange={(event) => changed(setFunctionZh)(event.currentTarget.value)}
                required
                value={functionZh}
              />
            </label>
            <label>
              槽位说明（每行“name: 中文说明”）
              <textarea
                name="slots"
                onChange={(event) => changed(setSlotText)(event.currentTarget.value)}
                placeholder="clause: 分句内容"
                required
                value={slotText}
              />
            </label>
          </>
        )}
        <label>
          中文用法
          <textarea
            maxLength={4000}
            name="usageZh"
            onChange={(event) => changed(setUsageZh)(event.currentTarget.value)}
            required
            value={usageZh}
          />
        </label>
        <label>
          标签（逗号分隔）
          <input
            name="tags"
            onChange={(event) => changed(setTags)(event.currentTarget.value)}
            value={tags}
          />
        </label>
        <label>
          系统属性（逗号分隔）
          <input
            name="systemAttributes"
            onChange={(event) => changed(setSystemAttributes)(event.currentTarget.value)}
            value={systemAttributes}
          />
        </label>
        <button disabled={busy} type="submit">
          {busy ? "正在收录…" : "收录到学习库"}
        </button>
      </form>
      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
