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
