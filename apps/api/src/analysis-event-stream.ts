import type { AnalysisEventRead } from "@huayi/cloud-contracts";
import type { Context } from "hono";
import { streamSSE, captureDiagnosticPayload } from "./diagnostic-stream.js";
import { createAnalysisReadView } from "./analysis-read-view.js";
import { CloudFault } from "./cloud-fault.js";

/** Only direct, ephemeral analysis streams may omit previews. Durable task cursors remain intact. */
export function streamAnalysisEvents(context: Context, events: AsyncIterable<AnalysisEventRead>) {
  return streamSSE(context, async (stream) => {
    const view = createAnalysisReadView(context.req.header("accept"));
    let id = 0,
      bytes = 0,
      previewBytes = 0,
      previewsExhausted = false;
    for await (const event of events) {
      captureDiagnosticPayload(event);
      const message = view.sse(event, id + 1);
      const size = Buffer.byteLength(
        `event: analysis\ndata: ${message.data}\nid: ${message.id}\n\n`,
        "utf8",
      );
      if (event.type === "analysis.preview" || event.type === "analysis.structure") {
        if (previewsExhausted || previewBytes + size > 512 * 1024) {
          previewsExhausted = true;
          continue;
        }
        previewBytes += size;
      }
      if (bytes + size > 2 * 1024 * 1024)
        throw new CloudFault("model_output_invalid", "The analysis stream exceeds its limit.");
      bytes += size;
      id += 1;
      await stream.writeSSE(message);
    }
  });
}
