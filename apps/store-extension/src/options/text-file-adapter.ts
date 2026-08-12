export interface TextFileAdapter {
  downloadText(filename: string, contents: string, mimeType: string): Promise<void>;
}

interface BrowserTextFileAdapterOptions {
  readonly document: Document;
  readonly url: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

export function createBrowserTextFileAdapter(
  options: BrowserTextFileAdapterOptions,
): TextFileAdapter {
  return {
    async downloadText(filename, contents, mimeType) {
      const objectUrl = options.url.createObjectURL(new Blob([contents], { type: mimeType }));
      const anchor = options.document.createElement("a");
      anchor.download = filename;
      anchor.href = objectUrl;
      anchor.hidden = true;
      options.document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        options.url.revokeObjectURL(objectUrl);
      }
    },
  };
}
