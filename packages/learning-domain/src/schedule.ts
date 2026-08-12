import type { PracticeRating, ScheduleState } from "./practice-schemas.js";

export const PRACTICE_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60] as const;
const DAY_MILLISECONDS = 86_400_000;

export function createNewSchedule(): ScheduleState {
  return { consecutiveMastered: 0, dueAt: null, level: -1 };
}

function nextLevel(currentLevel: number, rating: PracticeRating): number {
  if (currentLevel === -1 || rating === "forgot") return 0;
  if (rating === "effortful") return currentLevel;
  return Math.min(currentLevel + 1, PRACTICE_INTERVAL_DAYS.length - 1);
}

export function rateSchedule(
  state: ScheduleState,
  rating: PracticeRating,
  ratingTime: string,
): ScheduleState {
  const instant = new Date(ratingTime);
  if (!Number.isFinite(instant.getTime())) throw new Error("Rating time must be a valid instant.");
  const level = nextLevel(state.level, rating);
  const intervalDays = PRACTICE_INTERVAL_DAYS[level];
  if (intervalDays === undefined) throw new Error("Schedule level is outside the fixed ladder.");
  return {
    consecutiveMastered: rating === "mastered" ? state.consecutiveMastered + 1 : 0,
    dueAt: new Date(instant.getTime() + intervalDays * DAY_MILLISECONDS).toISOString(),
    lastRating: rating,
    level,
  };
}

export interface ScheduleRatingApplication {
  readonly after: ScheduleState;
  readonly itemId: string;
  readonly rating: PracticeRating;
  readonly ratingTime: string;
  readonly sessionId: string;
}

export interface IdempotentRatingInput {
  readonly itemId: string;
  readonly previous?: ScheduleRatingApplication;
  readonly rating: PracticeRating;
  readonly ratingTime: string;
  readonly sessionId: string;
  readonly state: ScheduleState;
}

export function rateScheduleIdempotently(input: IdempotentRatingInput): ScheduleRatingApplication {
  if (input.previous !== undefined) {
    if (
      input.previous.itemId !== input.itemId ||
      input.previous.sessionId !== input.sessionId ||
      input.previous.rating !== input.rating
    ) {
      throw new Error("Practice rating idempotency conflict.");
    }
    return input.previous;
  }
  return {
    after: rateSchedule(input.state, input.rating, input.ratingTime),
    itemId: input.itemId,
    rating: input.rating,
    ratingTime: input.ratingTime,
    sessionId: input.sessionId,
  };
}
