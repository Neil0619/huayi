import { createHash } from "node:crypto";

import {
  createWordbookJobRequestSchema,
  listWordbookJobsQuerySchema,
  normalizeHeadword,
  submitWordbookReceiptsRequestSchema,
  wordbookJobListResponseSchema,
  wordbookJobResourceSchema,
  wordbookJobRevisionRequestSchema,
  wordbookLeaseRequestSchema,
  wordbookLeaseResponseSchema,
  wordbookReceiptResponseSchema,
  type CreateWordbookJobRequest,
  type ListWordbookJobsQuery,
  type SubmitWordbookReceiptsRequest,
  type WordbookJobResource,
  type WordbookLeaseResponse,
} from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import { createExternalWordbookCursor } from "./external-wordbook-cursor.js";
import { createExternalWordbookLeaseToken } from "./external-wordbook-lease-token.js";

interface CreateCommand {
  idempotencyKey: string;
  jobId: string;
  now: string;
  ownerUserId: string;
  request: CreateWordbookJobRequest;
  requestHash: string;
}
interface ListQuery {
  boundary?: { createdAt: string; id: string };
  direction?: "import" | "export";
  limit: number;
  state?: WordbookJobResource["state"];
  target?: "eudic" | "shanbay";
}
interface LeaseCommand {
  expectedRevision: number;
  jobId: string;
  newExpiresAt: string;
  nonceHash: string;
  now: string;
  ownerUserId: string;
}
type RepositoryLease =
  | Omit<Extract<WordbookLeaseResponse, { kind: "export" }>, "leaseToken">
  | Omit<Extract<WordbookLeaseResponse, { kind: "eudic-import" }>, "leaseToken">;
type SanitizedReceiptRequest =
  | Omit<Extract<SubmitWordbookReceiptsRequest, { kind: "export" }>, "leaseToken">
  | Omit<Extract<SubmitWordbookReceiptsRequest, { kind: "eudic-import-page" }>, "leaseToken">
  | Omit<Extract<SubmitWordbookReceiptsRequest, { kind: "eudic-import-failure" }>, "leaseToken">;
export interface ImportedWordbookEntry {
  canonicalKey: string;
  contextId?: string;
  contentHash?: string;
  headword: string;
  itemId: string;
  observedAt: string;
  sourceText?: string;
  sourceType: "eudic";
  wordId: string;
}
interface SubmitCommand {
  idempotencyKey: string;
  importEntries?: ImportedWordbookEntry[];
  jobId: string;
  nonceHash: string;
  now: string;
  ownerUserId: string;
  request: SanitizedReceiptRequest;
  requestHash: string;
  tokenExpiresAt: string;
}
interface RevisionCommand {
  expectedRevision: number;
  idempotencyKey: string;
  jobId: string;
  now: string;
  ownerUserId: string;
  requestHash: string;
}

export interface ExternalWordbookRepository {
  cancel(command: RevisionCommand): Promise<WordbookJobResource>;
  create(command: CreateCommand): Promise<WordbookJobResource>;
  findById(ownerUserId: string, jobId: string): Promise<WordbookJobResource | null>;
  lease(command: LeaseCommand): Promise<RepositoryLease>;
  list(
    ownerUserId: string,
    query: ListQuery,
  ): Promise<{ hasMore: boolean; items: WordbookJobResource[] }>;
  retry(command: RevisionCommand): Promise<WordbookJobResource>;
  submit(command: SubmitCommand): Promise<WordbookJobResource>;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function receiptKind(request: SanitizedReceiptRequest): "eudic-import" | "export" {
  return request.kind === "export" ? "export" : "eudic-import";
}

export function createExternalWordbookModule(options: {
  cursorKey: Uint8Array;
  ids(): string;
  leaseDurationMs: number;
  leaseKey: Uint8Array;
  now(): Date;
  repository: ExternalWordbookRepository;
}) {
  if (!Number.isSafeInteger(options.leaseDurationMs) || options.leaseDurationMs < 1) {
    throw new RangeError("External wordbook lease duration must be positive.");
  }
  const cursor = createExternalWordbookCursor(options.cursorKey);
  const token = createExternalWordbookLeaseToken(options.leaseKey);
  const revisionCommand = (
    ownerUserId: string,
    jobId: string,
    idempotencyKey: string,
    input: unknown,
  ): RevisionCommand => {
    const request = wordbookJobRevisionRequestSchema.parse(input);
    return {
      expectedRevision: request.expectedRevision,
      idempotencyKey,
      jobId,
      now: options.now().toISOString(),
      ownerUserId,
      requestHash: digest({ jobId, request }),
    };
  };
  return {
    async cancel(ownerUserId: string, jobId: string, idempotencyKey: string, input: unknown) {
      return wordbookJobResourceSchema.parse(
        await options.repository.cancel(revisionCommand(ownerUserId, jobId, idempotencyKey, input)),
      );
    },
    async create(ownerUserId: string, idempotencyKey: string, input: unknown) {
      const request = createWordbookJobRequestSchema.parse(input);
      return wordbookJobResourceSchema.parse(
        await options.repository.create({
          idempotencyKey,
          jobId: options.ids(),
          now: options.now().toISOString(),
          ownerUserId,
          request,
          requestHash: digest({ operation: "wordbook.create", request }),
        }),
      );
    },
    async get(ownerUserId: string, jobId: string) {
      const found = await options.repository.findById(ownerUserId, jobId);
      return found === null ? null : wordbookJobResourceSchema.parse(found);
    },
    async lease(ownerUserId: string, jobId: string, input: unknown) {
      const request = wordbookLeaseRequestSchema.parse(input);
      const now = options.now();
      const claim = await options.repository.lease({
        expectedRevision: request.expectedRevision,
        jobId,
        newExpiresAt: new Date(now.getTime() + options.leaseDurationMs).toISOString(),
        nonceHash: digest(request.claimNonce),
        now: now.toISOString(),
        ownerUserId,
      });
      return wordbookLeaseResponseSchema.parse({
        ...claim,
        leaseToken: token.encode({
          expiresAt: claim.expiresAt,
          jobId,
          kind: claim.kind,
          nonce: request.claimNonce,
        }),
      });
    },
    async list(ownerUserId: string, input: ListWordbookJobsQuery) {
      const query = listWordbookJobsQuerySchema.parse(input);
      const page = await options.repository.list(ownerUserId, {
        ...(query.cursor === undefined ? {} : { boundary: cursor.decode(query.cursor) }),
        ...(query.direction === undefined ? {} : { direction: query.direction }),
        limit: query.limit ?? 20,
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.target === undefined ? {} : { target: query.target }),
      });
      const last = page.items.at(-1);
      return wordbookJobListResponseSchema.parse({
        items: page.items,
        nextCursor:
          page.hasMore && last !== undefined
            ? cursor.encode({ createdAt: last.createdAt, id: last.id })
            : null,
      });
    },
    async retry(ownerUserId: string, jobId: string, idempotencyKey: string, input: unknown) {
      return wordbookJobResourceSchema.parse(
        await options.repository.retry(revisionCommand(ownerUserId, jobId, idempotencyKey, input)),
      );
    },
    async submit(ownerUserId: string, jobId: string, idempotencyKey: string, input: unknown) {
      const parsed = submitWordbookReceiptsRequestSchema.parse(input);
      const proof = token.decode(parsed.leaseToken);
      const request: SanitizedReceiptRequest =
        parsed.kind === "export"
          ? { kind: parsed.kind, receipts: parsed.receipts }
          : parsed.kind === "eudic-import-page"
            ? { entries: parsed.entries, kind: parsed.kind, page: parsed.page }
            : {
                kind: parsed.kind,
                page: parsed.page,
                stableErrorCode: parsed.stableErrorCode,
              };
      if (proof.jobId !== jobId || proof.kind !== receiptKind(request)) {
        throw new CloudFault("wordbook_lease_stale", "The lease does not match this job.");
      }
      const importEntries =
        request.kind === "eudic-import-page"
          ? request.entries
              .map((entry) => {
                const source = {
                  observedAt: entry.addedAt,
                  ...(entry.contextLine === undefined ? {} : { sourceText: entry.contextLine }),
                  sourceType: "eudic" as const,
                };
                return {
                  canonicalKey: normalizeHeadword(entry.headword),
                  ...(entry.contextLine === undefined
                    ? {}
                    : { contextId: options.ids(), contentHash: digest(source) }),
                  headword: normalizeHeadword(entry.headword),
                  itemId: options.ids(),
                  observedAt: entry.addedAt,
                  ...(entry.contextLine === undefined ? {} : { sourceText: entry.contextLine }),
                  sourceType: "eudic" as const,
                  wordId: options.ids(),
                };
              })
              .sort(
                (left, right) =>
                  left.canonicalKey.localeCompare(right.canonicalKey) ||
                  left.observedAt.localeCompare(right.observedAt),
              )
          : undefined;
      const nonceHash = digest(proof.nonce);
      return wordbookReceiptResponseSchema.parse({
        job: await options.repository.submit({
          idempotencyKey,
          ...(importEntries === undefined ? {} : { importEntries }),
          jobId,
          nonceHash,
          now: options.now().toISOString(),
          ownerUserId,
          request,
          requestHash: digest({ jobId, nonceHash, request }),
          tokenExpiresAt: proof.expiresAt,
        }),
      }).job;
    },
  };
}

export type ExternalWordbookModule = ReturnType<typeof createExternalWordbookModule>;
