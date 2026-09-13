import { checkTeachingRelationships, checkTeachingStructure } from "./teaching-source-checks.js";
import { z } from "zod/v3";
import { resolveSourceFragments } from "./source-fragments.js";
import {
  sentenceStructureDraftSchema,
  sentenceStructureSchema,
  type SentenceStructure,
} from "./teaching-shapes.js";
export {
  sentenceStructureDraftSchema,
  sentenceStructureSchema,
  type SentenceStructureDraft,
  type SentenceStructure,
} from "./teaching-shapes.js";

function invalid(path: (string | number)[], message: string): never {
  throw new z.ZodError([{ code: z.ZodIssueCode.custom, path, message }]);
}

function withPath<T>(path: (string | number)[], operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new z.ZodError(
        error.issues.map((issue) => ({
          ...issue,
          path: [...path, ...issue.path],
        })),
      );
    throw error;
  }
}

export function assembleSentenceStructure(sourceText: string, draft: unknown): SentenceStructure {
  const parsed = sentenceStructureDraftSchema.parse(draft);
  const structure = {
    kind: parsed.kind,
    coreClauses: parsed.coreClauses.map((group, index) => ({
      ...group,
      fragments: withPath(["coreClauses", index, "fragments"], () =>
        resolveSourceFragments(sourceText, group.fragments),
      ),
    })),
    modifiers: parsed.modifiers.map((group, index) => ({
      ...group,
      fragments: withPath(["modifiers", index, "fragments"], () =>
        resolveSourceFragments(sourceText, group.fragments),
      ),
    })),
  };
  checkTeachingRelationships(structure, invalid);
  return structure;
}

export function validateSentenceStructureSource(
  sourceText: string,
  structure: unknown,
): SentenceStructure {
  const parsed = sentenceStructureSchema.parse(structure);
  checkTeachingStructure(sourceText, parsed, invalid);
  return parsed;
}
