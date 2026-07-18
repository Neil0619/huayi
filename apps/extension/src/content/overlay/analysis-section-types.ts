export interface TextSectionSpec {
  key: string;
  kind: "text";
  title: string;
  value: string | null | undefined;
}

export interface ContextSectionSpec {
  badge?: string | undefined;
  key: string;
  kind: "context";
  title: string;
  value: string | null | undefined;
}

export interface PronunciationSectionSpec {
  key: "pronunciation";
  kind: "pronunciation";
  value: string | null | undefined;
}

export interface ListSectionSpec {
  key: string;
  kind: "list";
  termList?: boolean;
  title: string;
  values: readonly string[] | null | undefined;
}

export interface SectionEntry {
  badge?: string | undefined;
  detail?: string | undefined;
  primary: string;
  secondary?: string | undefined;
}

export type EntryLayout = "comparisons" | "definitions" | "details" | "pairs";

export interface EntrySectionSpec {
  key: string;
  kind: "entries";
  layout: EntryLayout;
  title: string;
  values: readonly SectionEntry[] | null | undefined;
}

export type SectionSpec =
  | ContextSectionSpec
  | EntrySectionSpec
  | ListSectionSpec
  | PronunciationSectionSpec
  | TextSectionSpec;

export type RenderableSectionSpec = Exclude<SectionSpec, PronunciationSectionSpec>;
