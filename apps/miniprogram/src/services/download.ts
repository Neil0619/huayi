import Taro from "@tarojs/taro";
import { miniProgramRoutes, wordEntryHttpRoutes } from "@huayi/cloud-contracts";
import { apiOrigin } from "./http";
import { session } from "./session";
import { MiniError } from "./errors";

export async function downloadData(exportId?: string) {
  if (exportId) await session.reauthenticate();
  const token = await session.ensure();
  const path = exportId
    ? miniProgramRoutes.downloadExport.replace(":id", encodeURIComponent(exportId))
    : wordEntryHttpRoutes.export;
  const result = await Taro.downloadFile({
    url: apiOrigin() + path,
    header: { Authorization: `HuayiMiniProgram ${token}` },
    timeout: 60_000,
  });
  if (result.statusCode !== 200)
    throw new MiniError(result.statusCode === 401 ? "authentication_required" : "network_error");
  try {
    await Taro.shareFileMessage({
      filePath: result.tempFilePath,
      fileName: exportId ? "语见学习数据.ndjson" : "语见生词表.txt",
    });
  } finally {
    // Temporary sensitive files are removed after the user saves/shares or dismisses the sheet.
    Taro.getFileSystemManager().unlink({ filePath: result.tempFilePath });
  }
}
