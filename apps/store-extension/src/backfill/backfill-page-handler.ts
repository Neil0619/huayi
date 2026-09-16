import { handleBackfillPageReview, isBackfillPageReview } from "./backfill-page-review.js";
import type { BackfillContext } from "./backfill-authority.js";
import type { BackfillMessage } from "./backfill-messages.js";

export async function handleBackfillPage(
  context: BackfillContext,
  message: BackfillMessage,
  sender: { tab?: { id?: number | undefined } | undefined; documentId?: string | undefined },
) {
  const page = context.state.page;
  const tabId = sender.tab?.id;
  if (!page || page.scope !== context.scope || tabId !== page.tabId || !context.status().enabled)
    return { accepted: false, batch: null };
  if (context.shared && !context.state.scopes[context.scope]?.adopted)
    return { accepted: false, batch: null };
  const review = isBackfillPageReview(message);
  if (review && !sender.documentId) return { accepted: false, batch: null };
  const documentId = sender.documentId ?? "legacy-document";
  if (
    review &&
    page.documentId !== documentId &&
    (message.type !== "store/backfill-page-review" || !page.reviewRequested)
  )
    return { accepted: false, batch: null };
  if (page.documentId !== null && page.documentId !== (sender.documentId ?? "legacy-document")) {
    if (
      message.type !== "store/backfill-page-ready" &&
      !(message.type === "store/backfill-page-review" && page.reviewRequested)
    )
      return { accepted: false, batch: null };
    if (page.batch) await context.command({ action: "unknown", token: page.batch.token });
    page.batch = null;
    page.review = null;
  }
  page.documentId = sender.documentId ?? "legacy-document";
  if (review) return handleBackfillPageReview(context, message);
  if (message.type === "store/backfill-page-ready") {
    page.review = null;
    if (page.reviewRequested) {
      page.reviewRequested = false;
      await context.persist();
      return {
        accepted: true,
        review: true,
        batch: page.batch ? { batchAlias: page.batch.alias, items: page.batch.items } : null,
      };
    }
    if (page.batch === null) {
      const response = await context.command({ action: "claim", limit: 100 });
      page.batch = response.batch
        ? {
            token: response.batch.token,
            alias: crypto.randomUUID(),
            items: response.batch.headwords.map((headword) => ({
              headword,
              alias: crypto.randomUUID(),
            })),
          }
        : null;
      await context.persist();
    }
    const batch = page.batch;
    return {
      accepted: true,
      batch: batch ? { batchAlias: batch.alias, items: batch.items } : null,
    };
  }
  if (!("batchAlias" in message) || !page.batch || message.batchAlias !== page.batch.alias)
    return { accepted: false, batch: null };
  const token = page.batch.token;
  if (message.type === "store/backfill-renew")
    return { accepted: (await context.command({ action: "renew", token })).accepted, batch: null };
  if (message.type === "store/backfill-unknown") {
    const response = await context.command({ action: "unknown", token });
    page.batch = null;
    await context.persist();
    return { accepted: response.accepted, batch: null };
  }
  if (message.type !== "store/backfill-resolve") return { accepted: false, batch: null };
  const aliases = [...message.confirmedAliases, ...message.rejectedAliases];
  const map = new Map(page.batch.items.map((item) => [item.alias, item.headword]));
  if (
    aliases.length !== map.size ||
    new Set(aliases).size !== aliases.length ||
    aliases.some((alias) => !map.has(alias))
  )
    return { accepted: false, batch: null };
  const response = await context.command({
    action: "resolve",
    token,
    confirmed: message.confirmedAliases.flatMap((alias) => map.get(alias) ?? []),
    rejected: message.rejectedAliases.flatMap((alias) => map.get(alias) ?? []),
  });
  if (response.accepted) page.batch = null;
  await context.persist();
  return { accepted: response.accepted, batch: null };
}
