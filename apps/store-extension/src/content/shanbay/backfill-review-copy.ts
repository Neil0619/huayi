import type { BackfillPageReviewResponse } from "../../backfill/backfill-messages.js";

export function visibleBackfillUnknownCount(view: BackfillPageReviewResponse): number {
  return view.unknownBatches.reduce((sum, batch) => sum + batch.headwords.length, 0);
}

export function backfillReviewNeedsRefresh(
  previous: BackfillPageReviewResponse | null,
  view: BackfillPageReviewResponse,
  dismissedAlias: string,
): boolean {
  const dismissed = new Set(
    previous?.unknownBatches.find((batch) => batch.alias === dismissedAlias)?.headwords,
  );
  return (
    previous?.unresolvedCount !== view.unresolvedCount ||
    view.unknownBatches.some((batch) => batch.headwords.some((word) => dismissed.has(word))) ||
    view.items.length > view.unresolvedCount ||
    visibleBackfillUnknownCount(view) > view.unknownCount
  );
}

export function backfillReviewHasMore(view: BackfillPageReviewResponse): boolean {
  return (
    !!view.nextCursorAlias ||
    view.unresolvedCount + view.unknownCount > view.items.length + visibleBackfillUnknownCount(view)
  );
}

export function unknownBackfillConfirmation(discard: boolean): string {
  return discard
    ? "此批词将不再提醒或自动回填；不会删除扇贝已有的词，也不会记为添加成功。确认不再提醒？"
    : "请先到扇贝核对此批结果。确认需要重新预填这些词？语见无法读取扇贝完整词表。";
}

export function backfillReviewCopy(view: BackfillPageReviewResponse, protectedRemainder = false) {
  const reviewCount = view.unresolvedCount + view.unknownCount;
  return {
    summary: `待回填 ${view.pendingCount} · 需处理 ${view.unresolvedCount}${view.unknownCount ? ` · 待确认 ${view.unknownCount}` : ""}`,
    notice:
      protectedRemainder && reviewCount
        ? "其余提醒已清空。剩余词仍有正在进行的回填批次，请结束该批后刷新列表。"
        : view.unknownCount
          ? "已添加的词不用再次上传，可以选择“不再提醒”。"
          : reviewCount
            ? "需处理词在下方统一处理。"
            : view.pendingCount
              ? "需处理词已清空。"
              : "已处理完毕",
    help: view.unknownCount
      ? "语见未保存到这些批次的明确结果。已添加或不想继续，可选“不再提醒”；只有确认需要重新添加时才点“核对后重试”。"
      : reviewCount
        ? "修改后点击“继续回填”，再亲自点击扇贝“批量添加”。跳过的词不再提醒。"
        : view.pendingCount
          ? "需处理词已清空，点击“继续回填”添加剩余词。"
          : "已处理完毕，可以收起。扇贝中已添加的词保持不变。",
  };
}
