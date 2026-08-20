import { createHash } from "node:crypto";

import {
  finishPracticeSessionRequestSchema,
  practiceSessionResponseSchema,
  retryDialogueAssistantRequestSchema,
  startDialogueSessionRequestSchema,
  submitDialogueTurnRequestSchema,
  type PracticeSession,
} from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type { PaidPracticeGenerator } from "./paid-practice-generator.js";
import type { PracticeItem } from "./practice-module.js";

interface DialogueMutation {
  expectedRevision?: number;
  idempotencyKey: string;
  now: string;
  ownerUserId: string;
  requestHash: string;
  sessionId: string;
}

type DialogueGenerationClaim =
  | { claimed: false; session: PracticeSession }
  | { claimed: true; generationId: string; leaseToken: string; session: PracticeSession };

export interface DialoguePracticeRepository {
  beginAssistantRetry(
    command: DialogueMutation & {
      generationLeaseExpiresAt: string;
      generationLeaseToken: string;
      generationId: string;
    },
  ): Promise<DialogueGenerationClaim>;
  beginFinish(
    command: DialogueMutation & {
      generationLeaseExpiresAt: string;
      generationLeaseToken: string;
      generationId: string;
    },
  ): Promise<DialogueGenerationClaim>;
  completeAssistant(command: {
    assistantTurn: string;
    generationId: string;
    generationLeaseToken: string;
    idempotencyKey: string;
    now: string;
    operation: "practice.dialogue-turn" | "practice.dialogue-assistant-retry";
    ownerUserId: string;
    requestHash: string;
    sessionId: string;
    turnId: string;
  }): Promise<PracticeSession>;
  completeFinish(command: {
    finalFeedback: string;
    generationId: string;
    generationLeaseToken: string;
    idempotencyKey: string;
    itemFeedbacks: { feedback: string; itemId: string }[];
    now: string;
    ownerUserId: string;
    requestHash: string;
    sessionId: string;
  }): Promise<PracticeSession>;
  completeStart(command: {
    generationId: string;
    generationLeaseToken: string;
    idempotencyKey: string;
    now: string;
    opener: string;
    openerTurnId: string;
    ownerUserId: string;
    plan: { endConditionZh: string; roleZh: string; taskZh: string };
    prompt: string;
    requestHash: string;
    sessionId: string;
  }): Promise<PracticeSession>;
  findItems(ownerUserId: string, itemIds: string[]): Promise<PracticeItem[]>;
  recordUserTurn(
    command: DialogueMutation & {
      content: string;
      generationLeaseExpiresAt: string;
      generationLeaseToken: string;
      generationId: string;
      turnId: string;
    },
  ): Promise<DialogueGenerationClaim>;
  releaseGenerationLease(command: {
    generationLeaseToken: string;
    now: string;
    ownerUserId: string;
    sessionId: string;
  }): Promise<void>;
  reserveStart(
    command: DialogueMutation & {
      generationLeaseExpiresAt: string;
      generationLeaseToken: string;
      generationId: string;
      itemIds: string[];
    },
  ): Promise<
    | { claimed: false; session: PracticeSession }
    | { claimed: true; generationId: string; leaseToken: string; session: PracticeSession }
  >;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createDialoguePracticeModule(options: {
  generator: Pick<PaidPracticeGenerator, "generate">;
  id(): string;
  now(): Date;
  repository: DialoguePracticeRepository;
}) {
  const mutation = (ownerUserId: string, sessionId: string, key: string, input: unknown) => ({
    idempotencyKey: key,
    now: options.now().toISOString(),
    ownerUserId,
    requestHash: hash(input),
    sessionId,
  });
  const lease = () => ({
    generationLeaseExpiresAt: new Date(options.now().getTime() + 120_000).toISOString(),
    generationLeaseToken: options.id(),
  });
  const itemsFor = async (ownerUserId: string, session: PracticeSession) => {
    const items = await options.repository.findItems(
      ownerUserId,
      session.items.map((item) => item.itemId),
    );
    if (items.length !== session.items.length) {
      throw new CloudFault("not_found", "Practice item not found.");
    }
    return items;
  };
  const modelItems = (items: PracticeItem[]) =>
    items.map((item, index) => ({
      content: item.item.content,
      itemAlias: `item-${index + 1}`,
    }));
  const modelSession = (session: PracticeSession) => ({
    dialoguePlan: session.dialoguePlan,
    prompt: session.prompt,
    turns: session.turns.map(({ content, role }) => ({ content, role })),
  });
  const generateAssistant = async (
    claim: DialogueGenerationClaim,
    ownerUserId: string,
    key: string,
    operation: "practice.dialogue-turn" | "practice.dialogue-assistant-retry",
    requestHash: string,
  ) => {
    if (!claim.claimed) return practiceSessionResponseSchema.parse(claim.session);
    const generated = await options.generator.generate({
      generationId: claim.generationId,
      input: {
        items: modelItems(await itemsFor(ownerUserId, claim.session)),
        session: modelSession(claim.session),
      },
      kind: "dialogue-assistant",
      leaseToken: claim.leaseToken,
      ownerUserId,
    });
    if (generated === null) return practiceSessionResponseSchema.parse(claim.session);
    if (generated.kind !== "dialogue-assistant") {
      throw new CloudFault("invalid_request", "Dialogue assistant output is invalid.");
    }
    return practiceSessionResponseSchema.parse(
      await options.repository.completeAssistant({
        assistantTurn: generated.assistantTurn,
        generationId: claim.generationId,
        generationLeaseToken: claim.leaseToken,
        idempotencyKey: key,
        now: options.now().toISOString(),
        operation,
        ownerUserId,
        requestHash,
        sessionId: claim.session.id,
        turnId: options.id(),
      }),
    );
  };

  return {
    async finish(ownerUserId: string, sessionId: string, key: string, input: unknown) {
      const request = finishPracticeSessionRequestSchema.parse(input);
      const command = mutation(ownerUserId, sessionId, key, request);
      const claim = await options.repository.beginFinish({
        ...command,
        expectedRevision: request.expectedRevision,
        generationId: options.id(),
        ...lease(),
      });
      if (!claim.claimed) return practiceSessionResponseSchema.parse(claim.session);
      const items = await itemsFor(ownerUserId, claim.session);
      const generated = await options.generator.generate({
        generationId: claim.generationId,
        input: {
          items: modelItems(items),
          session: modelSession(claim.session),
        },
        kind: "dialogue-final-feedback",
        leaseToken: claim.leaseToken,
        ownerUserId,
      });
      if (generated === null) return practiceSessionResponseSchema.parse(claim.session);
      if (generated.kind !== "dialogue-final-feedback") {
        throw new CloudFault("invalid_request", "Dialogue feedback output is invalid.");
      }
      const itemFeedbacks = generated.itemFeedbacks.map(({ feedback, itemAlias }) => {
        const index = Number(itemAlias.slice("item-".length)) - 1;
        const itemId = claim.session.items[index]?.itemId;
        if (itemId === undefined) throw new CloudFault("invalid_request", "Item alias is invalid.");
        return { feedback, itemId };
      });
      if (
        itemFeedbacks.length !== items.length ||
        new Set(itemFeedbacks.map((item) => item.itemId)).size !== items.length
      ) {
        throw new CloudFault("invalid_request", "Dialogue feedback coverage is invalid.");
      }
      return practiceSessionResponseSchema.parse(
        await options.repository.completeFinish({
          finalFeedback: generated.summary,
          generationId: claim.generationId,
          generationLeaseToken: claim.leaseToken,
          idempotencyKey: key,
          itemFeedbacks,
          now: options.now().toISOString(),
          ownerUserId,
          requestHash: command.requestHash,
          sessionId,
        }),
      );
    },
    async retryAssistant(ownerUserId: string, sessionId: string, key: string, input: unknown) {
      const request = retryDialogueAssistantRequestSchema.parse(input);
      const command = mutation(ownerUserId, sessionId, key, request);
      return generateAssistant(
        await options.repository.beginAssistantRetry({
          ...command,
          expectedRevision: request.expectedRevision,
          generationId: options.id(),
          ...lease(),
        }),
        ownerUserId,
        key,
        "practice.dialogue-assistant-retry",
        command.requestHash,
      );
    },
    async startDialogue(ownerUserId: string, key: string, input: unknown) {
      const request = startDialogueSessionRequestSchema.parse(input);
      const items = await options.repository.findItems(ownerUserId, request.itemIds);
      if (items.length !== request.itemIds.length) {
        throw new CloudFault("not_found", "Learning item not found.");
      }
      const sessionId = options.id();
      const command = mutation(ownerUserId, sessionId, key, request);
      const claim = await options.repository.reserveStart({
        ...command,
        itemIds: request.itemIds,
        generationId: options.id(),
        ...lease(),
      });
      if (!claim.claimed) return practiceSessionResponseSchema.parse(claim.session);
      const generated = await options.generator.generate({
        generationId: claim.generationId,
        input: { items: modelItems(items) },
        kind: "dialogue-start",
        leaseToken: claim.leaseToken,
        ownerUserId,
      });
      if (generated === null) return practiceSessionResponseSchema.parse(claim.session);
      if (generated.kind !== "dialogue-start") {
        throw new CloudFault("invalid_request", "Dialogue start output is invalid.");
      }
      return practiceSessionResponseSchema.parse(
        await options.repository.completeStart({
          generationId: claim.generationId,
          generationLeaseToken: claim.leaseToken,
          idempotencyKey: key,
          now: options.now().toISOString(),
          opener: generated.opener,
          openerTurnId: options.id(),
          ownerUserId,
          plan: generated.plan,
          prompt: generated.prompt,
          requestHash: command.requestHash,
          sessionId: claim.session.id,
        }),
      );
    },
    async submitTurn(ownerUserId: string, sessionId: string, key: string, input: unknown) {
      const request = submitDialogueTurnRequestSchema.parse(input);
      const command = mutation(ownerUserId, sessionId, key, request);
      return generateAssistant(
        await options.repository.recordUserTurn({
          ...command,
          content: request.content,
          expectedRevision: request.expectedRevision,
          generationId: options.id(),
          ...lease(),
          turnId: options.id(),
        }),
        ownerUserId,
        key,
        "practice.dialogue-turn",
        command.requestHash,
      );
    },
  };
}

export type DialoguePracticeModule = ReturnType<typeof createDialoguePracticeModule>;
