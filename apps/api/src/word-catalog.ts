import { createHash } from "node:crypto";
import {
  normalizeHeadword,
  wordArchiveRequestSchema,
  wordCatalogEntrySchema,
  wordCatalogListSchema,
  wordCatalogQuerySchema,
} from "@huayi/cloud-contracts";
import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import { createWordLibraryCursor } from "./word-library-cursor.js";
interface Row {
  id: string;
  headword: string;
  canonical_key: string;
  notes: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}
const columns = "id::text,headword,canonical_key,notes,revision,created_at,updated_at,archived_at";
function entry(row: Row) {
  return wordCatalogEntrySchema.parse({
    archivedAt: row.archived_at?.toISOString() ?? null,
    word: {
      id: row.id,
      headword: row.headword,
      canonicalKey: row.canonical_key,
      ...(row.notes === null ? {} : { notes: row.notes }),
      revision: row.revision,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
  });
}
export function createWordCatalog(options: {
  database: AnalysisDatabase;
  cursorKey: Uint8Array;
  now(): Date;
}) {
  const cursor = createWordLibraryCursor(options.cursorKey).words;
  return {
    async list(owner: string, input: unknown) {
      const query = wordCatalogQuerySchema.parse(input);
      const boundary = query.cursor ? cursor.decode(query.cursor) : undefined;
      const limit = query.limit ?? 20;
      const search = query.query
        ? `%${normalizeHeadword(query.query).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
        : null;
      const rows = await options.database.transaction(owner, ({ tenant }) =>
        tenant.rows<Row>(
          `SELECT ${columns} FROM word_entries WHERE (archived_at IS NOT NULL)=$1 AND ($2::text IS NULL OR canonical_key COLLATE "C" LIKE $2 ESCAPE '\\') AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`,
          [query.archived, search, boundary?.createdAt ?? null, boundary?.id ?? null, limit + 1],
        ),
      );
      const items = rows.slice(0, limit).map(entry);
      const last = items.at(-1)?.word;
      return wordCatalogListSchema.parse({
        items,
        nextCursor:
          rows.length > limit && last
            ? cursor.encode({ createdAt: last.createdAt, id: last.id })
            : null,
      });
    },
    async state(owner: string, id: string) {
      const rows = await options.database.transaction(owner, ({ tenant }) =>
        tenant.rows<Row>(`SELECT ${columns} FROM word_entries WHERE id=$1`, [id]),
      );
      if (!rows[0]) throw new CloudFault("not_found", "Word entry not found.");
      return entry(rows[0]);
    },
    async archive(owner: string, id: string, key: string, input: unknown) {
      const request = wordArchiveRequestSchema.parse(input);
      const hash = createHash("sha256").update(JSON.stringify({ id, request })).digest("hex");
      return options.database.transaction(owner, async ({ tenant, trusted }) => {
        const replay = (
          await trusted.rows<{ response: unknown }>(
            "SELECT begin_idempotent_write($1,'word.archive',$2,$3) AS response",
            [owner, key, hash],
          )
        )[0]?.response;
        if (replay !== null && replay !== undefined) return wordCatalogEntrySchema.parse(replay);
        const row = (
          await tenant.rows<Row>(`SELECT ${columns} FROM word_entries WHERE id=$1 FOR UPDATE`, [id])
        )[0];
        if (!row) throw new CloudFault("not_found", "Word entry not found.");
        if (row.revision !== request.expectedRevision)
          throw new CloudFault("revision_conflict", "Word entry revision changed.");
        const now = options.now();
        const updated = (
          await tenant.rows<Row>(
            `UPDATE word_entries SET archived_at=$2,revision=revision+1,updated_at=$3 WHERE id=$1 RETURNING ${columns}`,
            [id, request.archived ? now : null, now],
          )
        )[0];
        if (!updated) throw new CloudFault("not_found", "Word entry not found.");
        const response = entry(updated);
        await tenant.rows(
          "INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at) VALUES($1,'word.archive',$2,$3,$4::jsonb,$5)",
          [owner, key, hash, JSON.stringify(response), new Date(now.getTime() + 7 * 86400000)],
        );
        return response;
      });
    },
  };
}
