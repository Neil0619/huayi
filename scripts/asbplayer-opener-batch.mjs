import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";

// Only native-picked sources enter this queue. Public IDs never encode filesystem paths.
export function createMediaBatch({ pickFiles, prepare }) {
  let items = [],
    busy = false,
    stopping = false,
    message = "";
  const snapshot = () => ({
    busy,
    stopping,
    message,
    items: items.map(({ source, ...item }) => ({ ...item, name: basename(source) })),
  });
  const start = async () => {
    if (busy) return;
    busy = true;
    stopping = false;
    message = "请选择要提前处理的视频，可按 Ctrl 或 Shift 多选。";
    try {
      const selected = await pickFiles();
      if (!selected?.length) {
        message = "已取消选择，保留上次批量结果。";
        return;
      }
      if (
        !Array.isArray(selected) ||
        selected.length > 500 ||
        selected.some((path) => typeof path !== "string" || !/\.(mkv|mp4|m4v)$/iu.test(path))
      )
        throw new Error("invalid selection");
      items = [...new Set(selected)].map((source) => ({
        id: randomUUID(),
        source,
        status: "waiting",
        message: "等待处理",
      }));
      for (const [index, item] of items.entries()) {
        if (stopping) {
          item.status = "skipped";
          item.message = "已停止，尚未处理";
          continue;
        }
        item.status = "preparing";
        message = `正在处理 ${index + 1} / ${items.length}`;
        try {
          const result = await prepare(item.source, (progress) => {
            item.message = progress;
          });
          item.directory = dirname(result.files.find((file) => file.kind === "video").path);
          item.status = "ready";
          item.message = "已准备好（有效缓存会自动复用）";
        } catch {
          item.status = "failed";
          item.message = "准备失败，请检查编码、工具和磁盘空间；可重新选择重试。";
        }
      }
      const count = (status) => items.filter((item) => item.status === status).length;
      message = `批量处理${stopping ? "已停止" : "完成"}：成功 ${count("ready")}，失败 ${count("failed")}，未处理 ${count("skipped")}。`;
    } catch {
      message = "无法开始批量处理，请重新选择最多 500 个本地视频。";
    } finally {
      busy = false;
      stopping = false;
    }
  };
  return {
    snapshot,
    start,
    stop: () => {
      if (busy) {
        stopping = true;
        message = "正在停止：完成当前文件后不再处理剩余视频。";
      }
    },
    sourceFor: (id) => items.find((item) => item.id === id && item.status === "ready")?.source,
  };
}
