import {
  canonicalKeyForContent,
  learningItemDetailResponseSchema,
  practiceSessionResponseSchema,
  type DailyPracticeQueueResponse,
  type LearningItemDetailResponse,
  type PracticeSession,
} from "@huayi/cloud-contracts";

export const now = "2026-08-13T10:00:00.000Z";
const itemOneContent = {
  meaningZh: "完全坦率地说",
  register: "spoken" as const,
  text: "to be completely frank",
  type: "expression" as const,
  usageZh: "用于直接而坦率地表达观点。",
};
const itemTwoContent = {
  functionZh: "建议某个行动值得进行",
  slots: [{ descriptionZh: "要采取的行动", name: "action" }],
  template: "It is worth {action}",
  type: "sentence_pattern" as const,
  usageZh: "用于提出经过权衡的行动建议。",
};
const schedule = { consecutiveMastered: 0, dueAt: null, level: -1 } as const;
export const queueItems: DailyPracticeQueueResponse["items"] = [
  {
    item: {
      content: itemOneContent,
      id: "practice-item-1",
      systemAttributes: ["spoken"],
      tags: ["conversation"],
      type: "expression",
    },
    schedule,
  },
  {
    item: {
      content: itemTwoContent,
      id: "practice-item-2",
      systemAttributes: ["writing"],
      tags: ["planning"],
      type: "sentence-pattern",
    },
    schedule,
  },
];

export function detail(index: 0 | 1): LearningItemDetailResponse {
  const content = index === 0 ? itemOneContent : itemTwoContent;
  const id = `practice-item-${index + 1}`;
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: {
      canonicalKey: canonicalKeyForContent(content),
      content,
      createdAt: now,
      id,
      revision: 1,
      sourceExamples: [
        {
          id: `practice-source-${index + 1}`,
          sourceText:
            index === 0
              ? "To be completely frank, we need stronger evidence."
              : "It is worth testing the risky assumption first.",
          sourceType: "manual",
        },
      ],
      systemAttributes: queueItems[index]?.item.systemAttributes ?? [],
      tags: queueItems[index]?.item.tags ?? [],
      type: index === 0 ? "expression" : "sentence-pattern",
      updatedAt: now,
    },
    recentPractice: null,
    schedule,
  });
}

function sessionItem(itemId: string, position: number) {
  return { itemId, position, scheduleBefore: schedule };
}

export function pendingSentence(): PracticeSession {
  return practiceSessionResponseSchema.parse({
    createdAt: now,
    id: "practice-session-sentence",
    items: [sessionItem("practice-item-1", 0)],
    pendingGeneration: "sentence-prompt",
    revision: 1,
    status: "awaiting-feedback",
    turns: [],
    workspace: { phase: "active", mode: "guided", draft: "", draftRevision: 0, controlRevision: 0 },
    type: "sentence-creation",
    updatedAt: now,
  });
}

export function dialogueStart(): PracticeSession {
  return practiceSessionResponseSchema.parse({
    createdAt: now,
    dialoguePlan: {
      endConditionZh: "共同确认下一步验证计划。",
      roleZh: "项目同事",
      taskZh: "讨论方案是否具备足够证据。",
    },
    id: "practice-session-dialogue",
    items: [sessionItem("practice-item-1", 0), sessionItem("practice-item-2", 1)],
    prompt: "Use both learning items while discussing a project plan.",
    revision: 1,
    status: "active",
    turns: [
      {
        content: "You are discussing a project plan with a colleague.",
        createdAt: now,
        id: "dialogue-turn-0",
        ordinal: 0,
        role: "assistant",
      },
    ],
    type: "dialogue",
    updatedAt: now,
  });
}
