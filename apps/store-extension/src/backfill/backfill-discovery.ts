import type { LexiconRepository } from "@huayi/store-domain";
import { backfillHeadwordSchema } from "@huayi/store-domain";
import type { EudicWordbookClient } from "../wordbook/eudic-client.js";
import type { BackfillContext, createBackfillAuthority } from "./backfill-authority.js";
import { BackfillDiscoveryError } from "./backfill-discovery-errors.js";
import { BackfillError } from "./backfill-errors.js";

export const BACKFILL_REFRESH_ALARM = "huayi-shanbay-refresh";
export const BACKFILL_EUDIC_ALARM = "huayi-shanbay-eudic";
function headwords(words: readonly string[]): string[] {
  return words.flatMap((word) => {
    const parsed = backfillHeadwordSchema.safeParse(word);
    return parsed.success ? [parsed.data] : [];
  });
}
export function nextBackfillMorning(now: Date, hour = 8): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}
function due(last: string | null, now: Date): boolean {
  if (last === null) return true;
  const boundary = new Date(now);
  boundary.setHours(8, 0, 0, 0);
  if (boundary.getTime() > now.getTime()) boundary.setDate(boundary.getDate() - 1);
  return Date.parse(last) < boundary.getTime();
}
export async function discoverBackfillSources(
  authority: Pick<ReturnType<typeof createBackfillAuthority>, "run">,
  options: {
    lexicon: Pick<LexiconRepository, "snapshot">;
    eudic: Pick<EudicWordbookClient, "listWords">;
    allowEudic(): Promise<boolean>;
    force?: boolean;
    localOnly?: boolean;
  },
): Promise<boolean> {
  const scan = await authority.run(async (context) => {
    if (!canDiscover(context)) {
      context.progress.checking = false;
      context.progress.forceRequested = false;
      return null;
    }
    const force = options.force || context.progress.forceRequested;
    context.progress.checking = true;
    return { scope: context.scope, identity: context.identity, force };
  });
  if (scan === null) return false;
  // Every commit re-reads the ledger. No stale copy spans an external source read.
  const run = <T>(operation: (context: BackfillContext) => Promise<T>) =>
    authority.run(async (context) => {
      if (context.scope !== scan.scope || context.identity !== scan.identity)
        throw new BackfillError("authentication");
      if (!canDiscover(context)) throw new BackfillScanCancelled();
      return operation(context);
    }, true);
  const source = async <T>(name: "local" | "eudic", read: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new DOMException("Timed out", "TimeoutError")), 15_000);
        }),
      ]);
    } catch (error) {
      throw new BackfillDiscoveryError(name, error);
    } finally {
      clearTimeout(timer);
    }
  };
  const command = async (
    context: BackfillContext,
    input: Parameters<BackfillContext["command"]>[0],
  ) => {
    try {
      return await context.command(input);
    } catch (error) {
      if (context.shared && error instanceof BackfillError && error.code !== "authentication")
        throw new BackfillDiscoveryError("cloud", error);
      throw error;
    }
  };
  try {
    const entries = await source("local", () => options.lexicon.snapshot());
    // One batch per pass, with acknowledged headwords persisted for later passes/restarts.
    let more = await run(async (context) => {
      const excluded = new Set(context.state.scopes[context.scope]?.localExcluded ?? []);
      const discovered = new Set(context.progress.localDiscovered);
      const pending = [
        ...new Set(
          headwords(
            entries.filter((entry) => !excluded.has(entry.headword)).map((entry) => entry.headword),
          ),
        ),
      ].filter((word) => !discovered.has(word));
      const batch = pending.slice(0, 100);
      if (batch.length > 0) {
        await command(context, { action: "discover", origin: "local", headwords: batch });
        context.progress.localDiscovered.push(...batch);
      }
      return pending.length > batch.length;
    });
    if (options.localOnly && !scan.force) return more;
    more = await run(async (context) => {
      if (!context.shared) return more;
      const response = await command(context, {
        action: "reconcile",
        cursor: context.progress.cloudCursor,
      });
      context.progress.cloudCursor = response.nextCursor;
      return more || response.nextCursor !== null;
    });
    const allowed = await source("eudic", options.allowEudic);
    const page = await run(async (context) => {
      const progress = context.progress;
      if (
        allowed &&
        progress.eudicPage === null &&
        (scan.force || progress.forceRequested || due(progress.eudicCompletedAt, new Date()))
      ) {
        progress.eudicPage = 0;
        progress.incomplete = false;
      }
      // Consume the request only once its Eudic page is durable (or that source is disabled).
      // Earlier local/cloud failures must retain the intent across a worker restart.
      progress.forceRequested = false;
      return progress.eudicPage;
    });
    if (!allowed && page !== null) return more;
    if (allowed && page !== null) {
      const words = await source("eudic", () =>
        options.eudic.listWords(page, AbortSignal.timeout(15_000)),
      );
      // Revoked source consent cancels ingestion as well as future requests.
      if (!(await source("eudic", options.allowEudic))) return more;
      more = await run(async (context) => {
        const progress = context.progress;
        if (progress.eudicPage !== page) throw new BackfillScanCancelled();
        await command(context, {
          action: "discover",
          origin: "eudic",
          headwords: headwords(words.map((word) => word.headword)),
        });
        if (words.length < 100 || page === 50) {
          progress.incomplete = page === 50 && words.length === 100;
          progress.eudicCompletedAt = new Date().toISOString();
          progress.eudicPage = null;
        } else {
          progress.eudicPage = page + 1;
          more = true;
        }
        return more;
      });
    }
    await run(async (context) => {
      context.progress.checkError = null;
      if (!more) context.progress.lastCheckedAt = new Date().toISOString();
    });
    return more;
  } catch (error) {
    if (error instanceof BackfillScanCancelled) return false;
    if (error instanceof BackfillDiscoveryError)
      await run(async (context) => {
        context.progress.checkError = error.message;
      });
    throw error;
  } finally {
    await authority.run(async (context) => {
      if (context.scope === scan.scope && context.identity === scan.identity)
        context.progress.checking = false;
    }, true);
  }
}
function canDiscover(context: BackfillContext): boolean {
  return (
    context.status().enabled &&
    (!context.shared || context.state.scopes[context.scope]?.adopted === true)
  );
}
class BackfillScanCancelled extends Error {}

export function backfillBadge(pending: number, needsAttention: boolean): string {
  return pending > 0 ? (pending > 999 ? "999+" : String(pending)) : needsAttention ? "!" : "";
}
