import { findBackfillLemmaCandidates } from "@huayi/store-domain";
import type { BackfillContext } from "./backfill-authority.js";
import { backfillPageReviewResponseSchema, type BackfillMessage } from "./backfill-messages.js";

export function isBackfillPageReview(message: BackfillMessage) {
  return (
    message.type === "store/backfill-page-review" ||
    message.type === "store/backfill-page-review-replace" ||
    message.type === "store/backfill-page-review-discard" ||
    message.type === "store/backfill-page-review-discard-all" ||
    message.type === "store/backfill-page-review-retry-unknown" ||
    message.type === "store/backfill-page-review-discard-unknown"
  );
}

export async function handleBackfillPageReview(context: BackfillContext, message: BackfillMessage) {
  const page = context.state.page;
  const rejected = { accepted: false, batch: null };
  const stale = { accepted: false, batch: null, reason: "stale" as const };
  if (!page) return rejected;
  await context.assertCurrent();
  const mapping = page.review;
  const sameIdentity = mapping?.identity === context.identity;
  const current = mapping && sameIdentity && mapping.revision === context.status().revision;
  if (message.type === "store/backfill-page-review") {
    let cursor: string | undefined;
    if (message.cursorAlias !== undefined) {
      if (!current || mapping.cursor?.alias !== message.cursorAlias)
        return sameIdentity ? stale : rejected;
      cursor = mapping.cursor.value;
    }
    // Retire the previous page even if the remote read fails; displayed aliases must
    // never remain actionable after an uncertain refresh or a revision change.
    page.review = null;
    page.reviewRequested = false;
    await context.persist();
    const response = await context.unresolved(cursor);
    await context.assertCurrent();
    if (response.revision !== context.status().revision) return stale;
    const items = response.items.map((source) => {
      const candidates =
        source.attempt === "original" ? findBackfillLemmaCandidates(source.headword) : [];
      return {
        alias: crypto.randomUUID(),
        headword: source.headword,
        target: source.target,
        explanation:
          source.attempt === "lemma"
            ? `已尝试原形「${source.target}」，扇贝仍未接受。`
            : source.attempt === "manual"
              ? `已尝试手动目标「${source.target}」，扇贝仍未接受。`
              : candidates.length > 1
                ? "存在多个可能的原形，请选择或填写目标词。"
                : candidates.length === 1
                  ? `可尝试原形「${candidates[0]}」，请核对目标词。`
                  : "原词被扇贝拒绝，未找到可靠的不同原形。",
        candidates,
      };
    });
    const unknownBatches = response.unknownBatches.map((batch) => ({
      alias: crypto.randomUUID(),
      token: batch.token,
      headwords: batch.headwords,
    }));
    const next =
      response.nextCursor === null
        ? null
        : {
            alias: crypto.randomUUID(),
            value: response.nextCursor,
          };
    page.review = {
      identity: context.identity,
      revision: response.revision,
      update: 0,
      sources: items.map((item) => ({ alias: item.alias, source: item.headword })),
      unknownBatches: unknownBatches.map((batch) => ({ alias: batch.alias, token: batch.token })),
      cursor: next,
    };
    const status = context.status();
    const result = backfillPageReviewResponseSchema.parse({
      accepted: true,
      pendingCount: status.pendingCount,
      unresolvedCount: status.unresolvedCount,
      unknownCount: status.unknownCount,
      items,
      unknownBatches: unknownBatches.map((batch) => ({
        alias: batch.alias,
        headwords: batch.headwords,
      })),
      nextCursorAlias: next?.alias ?? null,
    });
    await context.assertCurrent();
    await context.persist();
    return result;
  }
  if (!current) return sameIdentity ? stale : rejected;
  let response;
  if (message.type === "store/backfill-page-review-discard-all") {
    response = await context.command({
      action: "discard-review",
      expectedRevision: mapping.revision,
    });
  } else if (
    message.type === "store/backfill-page-review-retry-unknown" ||
    message.type === "store/backfill-page-review-discard-unknown"
  ) {
    const batch = mapping.unknownBatches.find((item) => item.alias === message.batchAlias);
    if (!batch) return stale;
    response = await context.command(
      message.type === "store/backfill-page-review-discard-unknown"
        ? { action: "discard-unknown", token: batch.token, expectedRevision: mapping.revision }
        : { action: "retry-unknown", token: batch.token },
    );
  } else if (
    message.type === "store/backfill-page-review-replace" ||
    message.type === "store/backfill-page-review-discard"
  ) {
    const source = mapping.sources.find((item) => item.alias === message.sourceAlias);
    if (!source) return stale;
    response = await context.command(
      message.type === "store/backfill-page-review-replace"
        ? {
            action: "replace",
            source: source.source,
            target: message.target,
            expectedRevision: mapping.revision,
          }
        : { action: "discard", source: source.source, expectedRevision: mapping.revision },
    );
  } else return rejected;
  if (!response.accepted) return stale;
  if (message.type === "store/backfill-page-review-discard-all") {
    mapping.sources = [];
    mapping.unknownBatches = [];
  } else if ("sourceAlias" in message)
    mapping.sources = mapping.sources.filter((item) => item.alias !== message.sourceAlias);
  else if ("batchAlias" in message)
    mapping.unknownBatches = mapping.unknownBatches.filter(
      (item) => item.alias !== message.batchAlias,
    );
  mapping.revision = response.status.revision;
  mapping.update += 1;
  await context.assertCurrent();
  await context.persist();
  return {
    accepted: true,
    update: mapping.update,
    pendingCount: response.status.pendingCount,
    unresolvedCount: response.status.unresolvedCount,
    unknownCount: response.status.unknownCount,
  };
}
