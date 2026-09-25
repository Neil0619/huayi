import type { Server } from "node:http";
export interface PreparedMediaFile {
  path: string;
  name: string;
  kind: string;
  type: string;
  size: number;
  language?: string;
}
export function startMediaOpener(options: {
  identityPath?: string;
  pickFile: (subtitle: boolean) => Promise<string | null>;
  pickFiles?: () => Promise<string[] | null>;
  pickCache?: () => Promise<string | null>;
  openCache?: (source: string) => Promise<{
    files: PreparedMediaFile[];
    reused?: boolean;
    sidecarSource?: string;
    plan: { imageSubtitleCount: number };
  }>;
  prepare: (
    source: string,
    progress: (message: string) => void,
  ) => Promise<{
    files: PreparedMediaFile[];
    plan: {
      imageSubtitleCount: number;
      audioIndex?: number | null;
      audioTrackCount?: number;
      audioLanguage?: string;
    };
  }>;
  sidecars: (source: string) => Promise<{ path: string; name: string }[]>;
}): Promise<{
  origin: string;
  token: string;
  url: string;
  close: () => Promise<void>;
  server?: Server;
  reused?: boolean;
}>;
