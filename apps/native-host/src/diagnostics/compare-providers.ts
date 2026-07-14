import { pathToFileURL } from "node:url";

import { analysisResultSchema, SCHEMA_VERSION } from "@huayi/protocol";
import type {
  AnalysisDeltaSection,
  AnalysisResult,
  AnalysisSectionPayload,
  AnalyzeRequest,
} from "@huayi/protocol";

import type { AnalysisProvider, AnalysisStreamUpdate } from "../provider/analysis-provider.js";
import { COMPARISON_CASES, type ComparisonCase } from "./comparison-corpus.js";

export const COMPARISON_PROFILE_IDS = [
  "codex-gpt-5.4-mini-low",
  "api-gpt-5.4-mini-low",
  "api-gpt-5.6-luna-none",
] as const;

export type ComparisonProfileId = (typeof COMPARISON_PROFILE_IDS)[number];

export const comparisonCaseIds = COMPARISON_CASES.map(({ id }) => id);

export interface ComparisonMilestoneRecorder {
  rawDelta(): void;
  upstreamSent(): void;
}

export type ComparisonProviderFactory = (
  milestones: ComparisonMilestoneRecorder,
) => AnalysisProvider;

interface TimingPercentiles {
  p50: number | null;
  p90: number | null;
}

type TimingName =
  | "firstRawDelta"
  | "firstValidatedVisibleUpdate"
  | "hostStart"
  | "providerStart"
  | "strictCompletion"
  | "upstreamSent";

interface SampleTimings extends Record<TimingName, number | null> {
  hostStart: number;
  providerStart: number;
}

export interface ComparisonArrival {
  atMs: number;
  index: number;
  kind: "item" | "section";
  section: AnalysisDeltaSection | AnalysisSectionPayload["section"];
}

export interface ComparisonSample {
  arrivals: ComparisonArrival[];
  caseId: string;
  profile: ComparisonProfileId;
  timingsMs: SampleTimings;
}

interface ProfileSummary {
  counts: { cancelled: number; invalid: number; success: number; total: number };
  percentilesMs: Record<TimingName, TimingPercentiles>;
  profile: ComparisonProfileId;
}

export interface ComparisonReport {
  designTargets: {
    firstVisibleImprovementPercent: 30;
    firstVisibleP50Ms: 2_000;
    strictCompletionImprovementPercent: 20;
  };
  profiles: ProfileSummary[];
  qualityPassed: boolean;
  samples: ComparisonSample[];
  schemaVersion: 1;
}

interface ComparisonRunOptions {
  now?: () => number;
  providers: Record<ComparisonProfileId, ComparisonProviderFactory>;
}

type SampleOutcome = "cancelled" | "invalid" | "success";

interface RecordedSample {
  outcome: SampleOutcome;
  sample: ComparisonSample;
}

export function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number | null {
  if (values.length === 0) return null;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100) {
    throw new RangeError("Percentile must be greater than zero and at most 100.");
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil((percentile / 100) * ordered.length) - 1] ?? null;
}

function requestFor(profile: ComparisonProfileId, fixture: ComparisonCase): AnalyzeRequest {
  return {
    action: fixture.action,
    context: fixture.context,
    requestId: `compare-${profile}-${fixture.id}`,
    schemaVersion: SCHEMA_VERSION,
    selection: fixture.selection,
    selectionKind: fixture.selectionKind,
    sentenceContext: fixture.sentenceContext,
    targetLanguage: "zh-CN",
    type: "analyze",
  };
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function expectedResultType(request: AnalyzeRequest): AnalysisResult["type"] {
  if (request.action === "translate") {
    return request.selectionKind === "word" || request.selectionKind === "phrase"
      ? "translate-lexical"
      : "translate-passage";
  }
  return request.selectionKind === "sentence" ? "explain-sentence" : "explain-lexical";
}

function isStrictResult(result: unknown, request: AnalyzeRequest): boolean {
  const parsed = analysisResultSchema.safeParse(result);
  return (
    parsed.success &&
    parsed.data.sourceText === request.selection &&
    parsed.data.selectionKind === request.selectionKind &&
    parsed.data.type === expectedResultType(request)
  );
}

function isCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "CANCELLED"
  );
}

function recordArrivals(
  update: AnalysisStreamUpdate,
  arrivals: ComparisonArrival[],
  now: () => number,
  startedAt: number,
  itemCounts: Map<string, number>,
  seenSections: Set<string>,
): void {
  if (update.type === "analysis-delta") {
    if (!seenSections.has(update.section)) {
      seenSections.add(update.section);
      arrivals.push({
        atMs: elapsed(now, startedAt),
        index: 0,
        kind: "section",
        section: update.section,
      });
    }
    return;
  }
  if (!Array.isArray(update.value)) {
    if (!seenSections.has(update.section)) {
      seenSections.add(update.section);
      arrivals.push({
        atMs: elapsed(now, startedAt),
        index: 0,
        kind: "section",
        section: update.section,
      });
    }
    return;
  }
  const previousCount = itemCounts.get(update.section) ?? 0;
  for (let index = previousCount; index < update.value.length; index += 1) {
    arrivals.push({ atMs: elapsed(now, startedAt), index, kind: "item", section: update.section });
  }
  itemCounts.set(update.section, Math.max(previousCount, update.value.length));
}

async function runSample(
  profile: ComparisonProfileId,
  fixture: ComparisonCase,
  factory: ComparisonProviderFactory,
  now: () => number,
): Promise<RecordedSample> {
  const startedAt = now();
  const timingsMs: SampleTimings = {
    firstRawDelta: null,
    firstValidatedVisibleUpdate: null,
    hostStart: 0,
    providerStart: elapsed(now, startedAt),
    strictCompletion: null,
    upstreamSent: null,
  };
  const milestones: ComparisonMilestoneRecorder = {
    rawDelta: () => {
      timingsMs.firstRawDelta ??= elapsed(now, startedAt);
    },
    upstreamSent: () => {
      timingsMs.upstreamSent ??= elapsed(now, startedAt);
    },
  };
  const provider = factory(milestones);
  const arrivals: ComparisonArrival[] = [];
  const itemCounts = new Map<string, number>();
  const seenSections = new Set<string>();
  const request = requestFor(profile, fixture);
  let outcome: SampleOutcome = "invalid";
  try {
    const result = await provider.analyze(request, new AbortController().signal, (update) => {
      timingsMs.firstValidatedVisibleUpdate ??= elapsed(now, startedAt);
      recordArrivals(update, arrivals, now, startedAt, itemCounts, seenSections);
    });
    if (isStrictResult(result, request)) {
      timingsMs.strictCompletion = elapsed(now, startedAt);
      outcome = "success";
    }
  } catch (error) {
    outcome = isCancellation(error) ? "cancelled" : "invalid";
  }
  return { outcome, sample: { arrivals, caseId: fixture.id, profile, timingsMs } };
}

function percentiles(samples: readonly ComparisonSample[], timing: TimingName): TimingPercentiles {
  const values = samples
    .map(({ timingsMs }) => timingsMs[timing])
    .filter((value): value is number => value !== null);
  return { p50: nearestRankPercentile(values, 50), p90: nearestRankPercentile(values, 90) };
}

export async function runProviderComparison(
  options: ComparisonRunOptions,
): Promise<ComparisonReport> {
  const now = options.now ?? performance.now.bind(performance);
  const recorded: RecordedSample[] = [];
  for (const profile of COMPARISON_PROFILE_IDS) {
    for (const fixture of COMPARISON_CASES) {
      recorded.push(await runSample(profile, fixture, options.providers[profile], now));
    }
  }

  const profiles = COMPARISON_PROFILE_IDS.map((profile): ProfileSummary => {
    const matching = recorded.filter(({ sample }) => sample.profile === profile);
    const successful = matching
      .filter(({ outcome }) => outcome === "success")
      .map(({ sample }) => sample);
    return {
      counts: {
        cancelled: matching.filter(({ outcome }) => outcome === "cancelled").length,
        invalid: matching.filter(({ outcome }) => outcome === "invalid").length,
        success: successful.length,
        total: matching.length,
      },
      percentilesMs: {
        firstRawDelta: percentiles(successful, "firstRawDelta"),
        firstValidatedVisibleUpdate: percentiles(successful, "firstValidatedVisibleUpdate"),
        hostStart: percentiles(successful, "hostStart"),
        providerStart: percentiles(successful, "providerStart"),
        strictCompletion: percentiles(successful, "strictCompletion"),
        upstreamSent: percentiles(successful, "upstreamSent"),
      },
      profile,
    };
  });
  return {
    designTargets: {
      firstVisibleImprovementPercent: 30,
      firstVisibleP50Ms: 2_000,
      strictCompletionImprovementPercent: 20,
    },
    profiles,
    qualityPassed: profiles.every(({ counts }) => counts.invalid === 0 && counts.cancelled === 0),
    samples: recorded.map(({ sample }) => sample),
    schemaVersion: 1,
  };
}

export function serializeComparisonReport(report: ComparisonReport): string {
  return JSON.stringify(
    {
      designTargets: report.designTargets,
      profiles: report.profiles,
      samples: report.samples,
    },
    null,
    2,
  );
}

export function comparisonTableRows(report: ComparisonReport): readonly Record<string, unknown>[] {
  return report.profiles.map(({ counts, percentilesMs, profile }) => ({
    cancelled: counts.cancelled,
    firstVisibleP50Ms: percentilesMs.firstValidatedVisibleUpdate.p50,
    firstVisibleP90Ms: percentilesMs.firstValidatedVisibleUpdate.p90,
    invalid: counts.invalid,
    profile,
    strictCompletionP50Ms: percentilesMs.strictCompletion.p50,
    strictCompletionP90Ms: percentilesMs.strictCompletion.p90,
    success: counts.success,
    total: counts.total,
  }));
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
}

if (isDirectExecution()) {
  if (process.argv.length !== 2) {
    process.stderr.write(
      "Provider comparison does not accept arguments; it uses fixed profiles and cases.\n",
    );
    process.exitCode = 1;
  } else {
    import("./run-provider-comparison.js")
      .then(
        ({ runConfiguredProviderComparison }) => runConfiguredProviderComparison(),
        () => Promise.reject(new Error("Provider comparison runtime unavailable.")),
      )
      .then(
        (exitCode) => {
          process.exitCode = exitCode;
        },
        () => {
          process.stderr.write("Provider comparison failed.\n");
          process.exitCode = 1;
        },
      );
  }
}
