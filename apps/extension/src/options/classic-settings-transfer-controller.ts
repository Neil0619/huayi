import type { ExtensionSettings } from "../settings/settings-domain.js";
import { serializeClassicSettingsTransfer } from "../settings/classic-settings-export.js";

export type ClassicSettingsDownload = (
  filename: string,
  contents: string,
  mimeType: string,
) => Promise<void>;

interface ClassicSettingsTransferControllerOptions {
  readonly download: ClassicSettingsDownload;
  readonly execute: (operation: () => Promise<void>, success: string) => void;
  readonly getSettings: () => ExtensionSettings;
}

export class ClassicSettingsTransferController {
  constructor(private readonly options: ClassicSettingsTransferControllerOptions) {}

  bind(): void {
    const button = document.querySelector<HTMLButtonElement>("[data-export-store-settings]");
    if (button === null) throw new Error("Missing Classic settings export button.");
    button.addEventListener("click", () => {
      this.options.execute(async () => {
        await this.options.download(
          "huayi-classic-settings-v1.json",
          serializeClassicSettingsTransfer(this.options.getSettings()),
          "application/json",
        );
      }, "无秘密设置包已导出。请在 Store Edition 设置页导入。");
    });
  }
}

export const browserClassicSettingsDownload: ClassicSettingsDownload = async (
  filename,
  contents,
  mimeType,
) => {
  const objectUrl = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = objectUrl;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
};
