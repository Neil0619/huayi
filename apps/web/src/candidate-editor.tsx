import type { AnalysisRecord, ConfirmCandidatesRequest } from "@huayi/cloud-contracts";

export interface CandidateDraft {
  readonly candidate: AnalysisRecord["candidates"][number];
  selected: boolean;
  systemAttributes: string;
  tags: string;
}

function splitValues(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function initialCandidateDrafts(analysis: AnalysisRecord): CandidateDraft[] {
  return analysis.candidates.map((candidate) => ({
    candidate: structuredClone(candidate),
    selected: true,
    systemAttributes: "",
    tags: "",
  }));
}

export function confirmationForDraft(
  draft: CandidateDraft,
): ConfirmCandidatesRequest["confirmations"][number] {
  if (draft.candidate.type === "expression") {
    return {
      candidateId: draft.candidate.id,
      decision: "create",
      payload: draft.candidate.payload,
      systemAttributes: splitValues(draft.systemAttributes),
      tags: splitValues(draft.tags),
      targetType: "expression",
    };
  }
  return {
    candidateId: draft.candidate.id,
    decision: "create",
    payload: draft.candidate.payload,
    systemAttributes: splitValues(draft.systemAttributes),
    tags: splitValues(draft.tags),
    targetType: "sentence-pattern",
  };
}

export function CandidateEditor({
  draft,
  index,
  onChange,
}: {
  readonly draft: CandidateDraft;
  readonly index: number;
  readonly onChange: (draft: CandidateDraft) => void;
}) {
  const candidate = draft.candidate;
  const updatePayload = (patch: Record<string, unknown>) =>
    onChange({
      ...draft,
      candidate: {
        ...candidate,
        payload: { ...candidate.payload, ...patch } as typeof candidate.payload,
      } as AnalysisRecord["candidates"][number],
    });
  const typeLabel = candidate.type === "expression" ? "表达" : "句型";
  return (
    <fieldset className="candidate-card" data-candidate-card>
      <legend>
        <label>
          <input
            checked={draft.selected}
            data-candidate-selected
            onChange={(event) => onChange({ ...draft, selected: event.currentTarget.checked })}
            type="checkbox"
          />
          {typeLabel} {index + 1}
        </label>
      </legend>
      {candidate.type === "expression" ? (
        <>
          <label>
            表达
            <input
              maxLength={500}
              onChange={(event) => updatePayload({ text: event.currentTarget.value })}
              required
              value={candidate.payload.text}
            />
          </label>
          <label>
            中文含义
            <textarea
              onChange={(event) => updatePayload({ meaningZh: event.currentTarget.value })}
              required
              value={candidate.payload.meaningZh}
            />
          </label>
          <label>
            使用说明
            <textarea
              onChange={(event) => updatePayload({ usageZh: event.currentTarget.value })}
              required
              value={candidate.payload.usageZh}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            句型模板
            <input
              maxLength={500}
              onChange={(event) => updatePayload({ template: event.currentTarget.value })}
              required
              value={candidate.payload.template}
            />
          </label>
          <label>
            功能
            <textarea
              onChange={(event) => updatePayload({ functionZh: event.currentTarget.value })}
              required
              value={candidate.payload.functionZh}
            />
          </label>
          <label>
            使用说明
            <textarea
              onChange={(event) => updatePayload({ usageZh: event.currentTarget.value })}
              required
              value={candidate.payload.usageZh}
            />
          </label>
        </>
      )}
      <div className="candidate-meta">
        <label>
          标签（逗号分隔）
          <input
            onChange={(event) => onChange({ ...draft, tags: event.currentTarget.value })}
            value={draft.tags}
          />
        </label>
        <label>
          系统属性（逗号分隔）
          <input
            onChange={(event) =>
              onChange({ ...draft, systemAttributes: event.currentTarget.value })
            }
            value={draft.systemAttributes}
          />
        </label>
      </div>
    </fieldset>
  );
}
