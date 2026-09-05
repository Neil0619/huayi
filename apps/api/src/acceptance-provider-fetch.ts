import { dailyPracticeQueueItemSchema, extensionQueryRequestSchema } from "@huayi/cloud-contracts";
import { z } from "zod/v3";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";

import {
  DEEPSEEK_PLATFORM_ENDPOINT,
  DEEPSEEK_PLATFORM_MODEL,
  type DeepSeekAnalysisFetchInit,
} from "./deepseek-analysis-protocol.js";

export const LOCAL_ACCEPTANCE_PROVIDER_KEY = "local-acceptance-simulated-provider";

const INVALID_REQUEST_MESSAGE = "Local acceptance model request is invalid.";
const MAXIMUM_REQUEST_BYTES = 64 * 1_024;
const SIMULATED_MARKER = "【本机模拟】";
const textSchema = z.string().trim().min(1).max(4_000);
const itemContentSchema = dailyPracticeQueueItemSchema.shape.item.shape.content;
const providerRequestSchema = z.strictObject({
  max_tokens: z.number().int().positive().max(8_192),
  messages: z
    .array(
      z.strictObject({
        content: z.string().min(1).max(MAXIMUM_REQUEST_BYTES),
        role: z.enum(["system", "user"]),
      }),
    )
    .min(2)
    .max(3),
  model: z.literal(DEEPSEEK_PLATFORM_MODEL),
  reasoning_effort: z.enum(["high", "low"]),
  response_format: z.strictObject({ type: z.literal("json_object") }),
  stream: z.boolean(),
  stream_options: z.strictObject({ include_usage: z.literal(true) }).optional(),
  temperature: z.literal(0),
  thinking: z.strictObject({ type: z.enum(["enabled", "disabled"]) }),
});
const analysisInputSchema = z.strictObject({
  selectionKind: z.enum(["phrase", "sentence", "passage"]),
  sentences: z
    .array(
      z.strictObject({
        analysisUnitId: z.string().regex(/^u(?:[1-9]|[1-3]\d|40)$/u),
        ordinal: z.number().int().min(0).max(39),
        sourceText: textSchema.max(2_000),
      }),
    )
    .min(1)
    .max(40),
  sourceText: textSchema.max(2_000),
});
const aliasedItemSchema = z.strictObject({
  content: itemContentSchema,
  itemAlias: z.enum(["item-1", "item-2", "item-3"]),
});
const practiceInputSchemaByKind = {
  "dialogue-assistant": z.strictObject({
    items: z.array(aliasedItemSchema).min(1).max(3),
    session: z.unknown(),
  }),
  "dialogue-final-feedback": z.strictObject({
    items: z.array(aliasedItemSchema).min(1).max(3),
    session: z.unknown(),
  }),
  "dialogue-start": z.strictObject({ items: z.array(aliasedItemSchema).min(1).max(3) }),
  "sentence-feedback": z.strictObject({
    answer: textSchema,
    itemContent: itemContentSchema,
    prompt: textSchema,
  }),
  "sentence-prompt": z.strictObject({ itemContent: itemContentSchema }),
} as const;
const duplicateInputSchema = z.strictObject({
  candidates: z
    .array(
      z.strictObject({
        alias: z.string().regex(/^candidate-(?:[1-9]|[1-4][0-9]|50)$/u),
        content: itemContentSchema,
      }),
    )
    .max(50),
  source: z.strictObject({ content: itemContentSchema }),
});

type PracticeKind = keyof typeof practiceInputSchemaByKind;

function invalidRequest(): TypeError {
  return new TypeError(INVALID_REQUEST_MESSAGE);
}

function boundedExpression(sourceText: string): string {
  return sourceText.slice(0, 500).trim() || "sample expression";
}

function firstEnglishToken(sourceText: string): string {
  return sourceText.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/u)?.[0] ?? "sample";
}

function parseUntrustedInput(message: string): unknown {
  const prefix = "UNTRUSTED_INPUT_BEGIN\n";
  const suffix = "\nUNTRUSTED_INPUT_END";
  if (!message.startsWith(prefix) || !message.endsWith(suffix)) throw invalidRequest();
  return JSON.parse(message.slice(prefix.length, -suffix.length));
}

function analysisOutput(rawInput: unknown) {
  const input = analysisInputSchema.parse(rawInput);
  const candidate = {
    analysisUnitId: "u1",
    id: "candidate-1",
    ordinal: 0,
    payload: {
      meaningZh: `${SIMULATED_MARKER}示例含义，仅用于本机流程验收。`,
      register: "neutral",
      text: boundedExpression(input.sourceText),
      type: "expression",
      usageZh: `${SIMULATED_MARKER}示例用法，不代表真实模型建议。`,
    },
    type: "expression",
  } as const;
  if (input.selectionKind === "phrase") {
    return {
      previewZh: `${SIMULATED_MARKER}先理解原文，再选择可以复用的表达。`,
      candidates: [candidate],
      result: {
        analysisUnitId: "u1",
        candidateIds: [candidate.id],
        contextualMeaningZh: `${SIMULATED_MARKER}这是固定的语境义演示。`,
        register: "neutral",
        structureAndCollocationZh: [`${SIMULATED_MARKER}这是固定的结构与搭配演示。`],
        translationZh: `${SIMULATED_MARKER}示例翻译。`,
        type: "phrase-analysis-v2",
        usageNotes: [],
      },
    };
  }
  return {
    previewZh: `${SIMULATED_MARKER}先理解原文，再选择可以复用的表达。`,
    candidates: [candidate],
    result: {
      overall: {
        contextAndToneZh: `${SIMULATED_MARKER}这是固定的语气演示。`,
        translationZh: `${SIMULATED_MARKER}示例翻译。`,
        understandingZh: `${SIMULATED_MARKER}这是固定的整体理解演示。`,
      },
      sentences: input.sentences.map((sentence, index) => ({
        ...sentence,
        candidateIds: index === 0 ? [candidate.id] : [],
        expressions: [],
        grammar: [],
        languageNotes: [],
        structure: [],
        translationZh: `${SIMULATED_MARKER}第 ${index + 1} 个分析单元的示例翻译。`,
      })),
      type: "sentence-passage-analysis-v2",
    },
  };
}

function extensionOutput(type: string, rawInput: unknown) {
  const input = extensionQueryRequestSchema.parse(rawInput);
  const token = firstEnglishToken(input.sourceText);
  if (type === "translate-word") {
    return {
      commonMeanings: [{ meaningsZh: [`${SIMULATED_MARKER}示例常见义。`], partOfSpeech: "other" }],
      commonPhrases: [],
      confusableWords: [],
      contextualSense: { meaningZh: `${SIMULATED_MARKER}示例语境义。`, partOfSpeech: "other" },
      dictionaryForm: token,
      selectionKind: "word",
      type,
    };
  }
  if (type === "explain-word") {
    return {
      contextualAnalysisZh: `${SIMULATED_MARKER}示例单词解释。`,
      selectionKind: "word",
      synonyms: [],
      type,
      usageNotes: [
        {
          descriptionZh: `${SIMULATED_MARKER}示例用法说明。`,
          titleZh: `${SIMULATED_MARKER}用法`,
        },
      ],
      wordForm: { baseForm: token, formTypeZh: `${SIMULATED_MARKER}示例词形。` },
    };
  }
  if (type === "translate-lexical") {
    return {
      collocations: [],
      contextualMeaningZh: `${SIMULATED_MARKER}示例短语义。`,
      partOfSpeech: "phrase",
      selectionKind: "phrase",
      similarTerms: [],
      type,
    };
  }
  if (type === "explain-lexical") {
    return {
      collocations: [],
      contextualMeaningZh: `${SIMULATED_MARKER}示例短语解释。`,
      coreMeanings: [{ meaningZh: `${SIMULATED_MARKER}示例核心义。`, partOfSpeech: "phrase" }],
      selectionKind: "phrase",
      synonyms: [],
      type,
    };
  }
  if (type === "translate-passage") {
    if (input.selectionKind !== "sentence" && input.selectionKind !== "passage") {
      throw invalidRequest();
    }
    return {
      selectionKind: input.selectionKind,
      translationZh: `${SIMULATED_MARKER}示例句段翻译。`,
      type,
    };
  }
  if (type === "explain-sentence") {
    if (input.selectionKind !== "sentence" && input.selectionKind !== "passage") {
      throw invalidRequest();
    }
    return {
      contextRole: `${SIMULATED_MARKER}示例语境作用。`,
      keyExpressions: [{ meaningZh: `${SIMULATED_MARKER}示例表达义。`, text: token }],
      mainStructure: `${SIMULATED_MARKER}示例句子结构。`,
      selectionKind: input.selectionKind,
      translationZh: `${SIMULATED_MARKER}示例句子翻译。`,
      type,
    };
  }
  throw invalidRequest();
}

function duplicateOutput(rawInput: unknown) {
  const input = duplicateInputSchema.parse(rawInput);
  const first = input.candidates[0];
  return {
    suggestions:
      first === undefined
        ? []
        : [
            {
              alias: first.alias,
              confidence: 0.91,
              reasonZh: `${SIMULATED_MARKER}固定返回首个服务器候选，用于验收交互。`,
            },
          ],
  };
}

function practiceOutput(kind: PracticeKind, rawInput: unknown) {
  const input = practiceInputSchemaByKind[kind].parse(rawInput);
  if (kind === "sentence-prompt") {
    return { kind, prompt: `${SIMULATED_MARKER}请使用当前学习项写一个英文句子。` };
  }
  if (kind === "sentence-feedback") {
    return { feedback: `${SIMULATED_MARKER}这是固定反馈，用于检查保存与重试。`, kind };
  }
  if (kind === "dialogue-start") {
    return {
      kind,
      opener: `${SIMULATED_MARKER}Hello, let's begin the local practice.`,
      plan: {
        endConditionZh: `${SIMULATED_MARKER}完成三轮对话后结束。`,
        roleZh: `${SIMULATED_MARKER}练习伙伴`,
        taskZh: `${SIMULATED_MARKER}使用学习项完成简短对话。`,
      },
      prompt: `${SIMULATED_MARKER}这是固定的本机对话场景。`,
    };
  }
  if (kind === "dialogue-assistant") {
    return {
      assistantTurn: `${SIMULATED_MARKER}Thanks. Please continue the local practice.`,
      kind,
    };
  }
  const aliases = (input as z.infer<(typeof practiceInputSchemaByKind)["dialogue-final-feedback"]>)
    .items;
  return {
    itemFeedbacks: aliases.map(({ itemAlias }) => ({
      feedback: `${SIMULATED_MARKER}这是该学习项的固定反馈。`,
      itemAlias,
    })),
    kind,
    summary: `${SIMULATED_MARKER}这是固定的对话总结。`,
  };
}

function simulatedContent(system: string, rawInput: unknown) {
  if (system.includes("You analyze English for a Chinese learner.")) {
    return analysisOutput(rawInput);
  }
  if (system.includes("Huayi's compact English query engine")) {
    const match = /The type field must be ([a-z-]+)\./u.exec(system);
    if (match?.[1] === undefined) throw invalidRequest();
    return extensionOutput(match[1], rawInput);
  }
  if (system.includes("Identify possible semantic duplicates for a Chinese learner.")) {
    return duplicateOutput(rawInput);
  }
  if (system.includes("You create bounded English practice for a Chinese learner.")) {
    const match = /Return exactly \{kind:'([^']+)'/u.exec(system);
    const kind = match?.[1];
    if (kind === undefined || !(kind in practiceInputSchemaByKind)) throw invalidRequest();
    return practiceOutput(kind as PracticeKind, rawInput);
  }
  throw invalidRequest();
}

function assertRequest(url: string, init: DeepSeekAnalysisFetchInit) {
  if (
    url !== DEEPSEEK_PLATFORM_ENDPOINT ||
    init.method !== "POST" ||
    init.credentials !== "omit" ||
    init.redirect !== "error" ||
    init.signal.aborted ||
    new TextEncoder().encode(init.body).byteLength > MAXIMUM_REQUEST_BYTES
  ) {
    throw invalidRequest();
  }
  const headers = Object.fromEntries(
    Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  if (
    Object.keys(init.headers).length !== 3 ||
    Object.keys(headers).length !== 3 ||
    !["application/json", "text/event-stream, application/json"].includes(headers.accept ?? "") ||
    headers["content-type"] !== "application/json" ||
    headers.authorization !== `Bearer ${LOCAL_ACCEPTANCE_PROVIDER_KEY}`
  ) {
    throw invalidRequest();
  }
  const parsed = providerRequestSchema.parse(JSON.parse(init.body));
  const system = parsed.messages[0];
  const user = parsed.messages[1];
  if (
    system?.role !== "system" ||
    user?.role !== "user" ||
    parsed.messages.slice(2).some((message) => message.role !== "user")
  ) {
    throw invalidRequest();
  }
  return {
    rawInput: parseUntrustedInput(user.content),
    system: system.content,
    stream: parsed.stream,
  };
}

export async function acceptanceProviderFetch(
  url: string,
  init: DeepSeekAnalysisFetchInit,
): Promise<Response> {
  try {
    const request = assertRequest(url, init);
    const content = simulatedContent(request.system, request.rawInput);
    return simulatedProviderResponse(content, request.stream);
  } catch {
    throw invalidRequest();
  }
}
