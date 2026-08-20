export interface WordListExportRepository {
  listCanonicalKeys(ownerUserId: string): Promise<string[]>;
}

export function createWordListExport(options: { repository: WordListExportRepository }) {
  return {
    async text(ownerUserId: string): Promise<string> {
      const keys = await options.repository.listCanonicalKeys(ownerUserId);
      return keys.length === 0 ? "" : `${keys.join("\n")}\n`;
    },
  };
}

export type WordListExport = ReturnType<typeof createWordListExport>;

export function createPostgresWordListExportRepository(database: {
  transaction<Result>(
    ownerUserId: string,
    operation: (queries: {
      tenant: { rows<Row>(text: string, parameters?: readonly unknown[]): Promise<Row[]> };
    }) => Promise<Result>,
  ): Promise<Result>;
}): WordListExportRepository {
  return {
    listCanonicalKeys(ownerUserId) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        const rows = await tenant.rows<{ canonical_key: string }>(
          "SELECT canonical_key FROM word_entries ORDER BY canonical_key,id",
        );
        return rows.map(({ canonical_key }) => canonical_key);
      });
    },
  };
}
