export class LearningTaskError extends Error {
  constructor(
    readonly code: string,
    readonly diagnosticId?: string,
  ) {
    super(`Learning task failed: ${code}.`);
  }
}
