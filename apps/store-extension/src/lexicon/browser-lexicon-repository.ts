import {
  normalizeHeadword,
  normalizeObservationSentence,
  wordEntrySchema,
  type ContextObservation,
  type LexiconPage,
  type LexiconQuery,
  type LexiconRepository,
  type SaveWordInput,
  type WordEntry,
} from "@huayi/store-domain";

import type { EncryptedLexiconRecord } from "./lexicon-codec.js";
import { createLexiconCryptoContext, type LexiconCryptoContext } from "./lexicon-crypto.js";
import { LexiconError } from "./lexicon-error.js";
import { createIndexedDbLexiconStore, type LexiconRecordStore } from "./indexeddb-lexicon-store.js";
import { createProductionDeviceDekSource, type DeviceDekSource } from "./device-dek-source.js";

export const PRODUCTION_LEXICON_DATABASE_NAME = "huayi-store-lexicon";

const MAX_WRITE_ATTEMPTS = 5;
const MAX_PAGE_SIZE = 100;

interface BrowserLexiconRepositoryOptions {
  readonly clock: () => Date;
  readonly crypto: Crypto;
  readonly dekSource: DeviceDekSource;
  readonly randomId: () => string;
  readonly store: LexiconRecordStore;
}

interface HealthyRecord {
  readonly entry: WordEntry;
  readonly record: EncryptedLexiconRecord;
}

interface HealthySnapshot {
  readonly generation: number;
  readonly records: HealthyRecord[];
}

function compareEntries(left: HealthyRecord, right: HealthyRecord): number {
  if (left.entry.id < right.entry.id) {
    return -1;
  }
  return left.entry.id > right.entry.id ? 1 : 0;
}

function parseQuery(query: LexiconQuery): Required<Pick<LexiconQuery, "limit">> & LexiconQuery {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > MAX_PAGE_SIZE) {
    throw new RangeError(`Lexicon page limit must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  if (query.cursor !== undefined && !/^[a-f0-9]{64}$/.test(query.cursor)) {
    throw new RangeError("Lexicon cursor is invalid.");
  }
  return query;
}

class BrowserLexiconRepository implements LexiconRepository {
  constructor(private readonly options: BrowserLexiconRepositoryOptions) {}

  async save(input: SaveWordInput): Promise<WordEntry> {
    const headword = normalizeHeadword(input.headword);
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const cryptoContext = await this.createCryptoContext();
      const opaqueId = await cryptoContext.opaqueId(headword);
      const snapshot = await this.readHealthyRecords(cryptoContext);
      const current = snapshot.records.find((item) => item.record.opaqueId === opaqueId) ?? null;
      const candidate = this.createSaveCandidate(input, headword, current?.entry ?? null);
      if (current !== null && candidate === current.entry) {
        return current.entry;
      }
      const revision = (current?.record.revision ?? 0) + 1;
      const encrypted = await cryptoContext.encryptRecord(candidate, opaqueId, revision);
      if (
        await this.options.store.compareAndSwap(
          encrypted,
          current?.record.revision ?? null,
          snapshot.generation,
        )
      ) {
        return candidate;
      }
    }
    throw new LexiconError("concurrent-modification");
  }

  async findByHeadword(headword: string): Promise<WordEntry | null> {
    const normalized = normalizeHeadword(headword);
    const cryptoContext = await this.createCryptoContext();
    const record = await this.options.store.read(await cryptoContext.opaqueId(normalized));
    return record === null ? null : cryptoContext.decryptRecord(record);
  }

  async list(query: LexiconQuery): Promise<LexiconPage> {
    const parsedQuery = parseQuery(query);
    const cryptoContext = await this.createCryptoContext();
    let records = (await this.readHealthyRecords(cryptoContext)).records.sort(compareEntries);
    const search = parsedQuery.search?.trim();
    if (search !== undefined && search.length > 0) {
      const normalizedSearch = normalizeHeadword(search);
      records = records.filter(({ entry }) => entry.headword.includes(normalizedSearch));
    }
    const start =
      parsedQuery.cursor === undefined
        ? 0
        : records.findIndex(({ record }) => record.opaqueId === parsedQuery.cursor) + 1;
    if (parsedQuery.cursor !== undefined && start === 0) {
      throw new RangeError("Lexicon cursor does not belong to this query.");
    }
    const page = records.slice(start, start + parsedQuery.limit);
    const hasNext = start + page.length < records.length;
    return {
      entries: page.map(({ entry }) => entry),
      nextCursor: hasNext ? (page.at(-1)?.record.opaqueId ?? null) : null,
    };
  }

  async snapshot(): Promise<readonly WordEntry[]> {
    const cryptoContext = await this.createCryptoContext();
    return (await this.readHealthyRecords(cryptoContext)).records
      .sort(compareEntries)
      .map(({ entry }) => entry);
  }

  async delete(entryId: string): Promise<boolean> {
    const normalized = normalizeHeadword(entryId);
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const cryptoContext = await this.createCryptoContext();
      const opaqueId = await cryptoContext.opaqueId(normalized);
      const snapshot = await this.readHealthyRecords(cryptoContext);
      const current = snapshot.records.find((item) => item.record.opaqueId === opaqueId);
      if (current === undefined) {
        return false;
      }
      if (
        await this.options.store.deleteIfRevision(
          opaqueId,
          current.record.revision,
          snapshot.generation,
        )
      ) {
        return true;
      }
    }
    throw new LexiconError("concurrent-modification");
  }

  async exportWordList(): Promise<string> {
    const cryptoContext = await this.createCryptoContext();
    const headwords = (await this.readHealthyRecords(cryptoContext)).records
      .sort(compareEntries)
      .map(({ entry }) => entry.headword);
    return headwords.length === 0 ? "" : `${headwords.join("\n")}\n`;
  }

  private async createCryptoContext(): Promise<LexiconCryptoContext> {
    const dek = await this.options.dekSource.read();
    return createLexiconCryptoContext(this.options.crypto, dek);
  }

  private createSaveCandidate(
    input: SaveWordInput,
    headword: string,
    current: WordEntry | null,
  ): WordEntry {
    if (current !== null && input.context === undefined) {
      return current;
    }
    const now = this.options.clock().toISOString();
    const contexts = [...(current?.contexts ?? [])];
    if (input.context !== undefined) {
      const sentenceKey = normalizeObservationSentence(input.context.sentence);
      const duplicate = contexts.some(
        (context) =>
          context.source === input.context?.source &&
          normalizeObservationSentence(context.sentence) === sentenceKey,
      );
      if (duplicate) {
        return current ?? this.createEmptyEntry(headword, now);
      }
      const observation: ContextObservation =
        input.context.source === "eudic-import"
          ? {
              id: this.options.randomId(),
              observedAt: input.context.observedAt,
              sentence: input.context.sentence,
              source: "eudic-import",
            }
          : {
              contextualMeaningZh: input.context.contextualMeaningZh,
              id: this.options.randomId(),
              observedAt: now,
              sentence: input.context.sentence,
              source: input.context.source,
            };
      contexts.push(observation);
    }
    return wordEntrySchema.parse({
      contexts,
      createdAt: current?.createdAt ?? now,
      headword,
      id: headword,
      updatedAt: now,
    });
  }

  private createEmptyEntry(headword: string, now: string): WordEntry {
    return wordEntrySchema.parse({
      contexts: [],
      createdAt: now,
      headword,
      id: headword,
      updatedAt: now,
    });
  }

  private async readHealthyRecords(cryptoContext: LexiconCryptoContext): Promise<HealthySnapshot> {
    const snapshot = await this.options.store.readAll();
    const records = await Promise.all(
      snapshot.records.map(async (record) => ({
        entry: await cryptoContext.decryptRecord(record),
        record,
      })),
    );
    return { generation: snapshot.generation, records };
  }
}

export function createBrowserLexiconRepository(
  options: BrowserLexiconRepositoryOptions,
): LexiconRepository {
  return new BrowserLexiconRepository(options);
}

export function createProductionLexiconRepository(): LexiconRepository {
  return createBrowserLexiconRepository({
    clock: () => new Date(),
    crypto: globalThis.crypto,
    dekSource: createProductionDeviceDekSource(),
    randomId: () => globalThis.crypto.randomUUID(),
    store: createIndexedDbLexiconStore({
      databaseName: PRODUCTION_LEXICON_DATABASE_NAME,
      indexedDB: globalThis.indexedDB,
    }),
  });
}
