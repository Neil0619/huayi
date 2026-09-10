import { describe, expect, it } from "vitest";
import { createLearningTaskSseDecoder } from "./learning-task-sse-decoder.js";
const id = "00000000-0000-4000-8000-000000000001";
const event = (cursor: number, taskId = id) =>
  `event: learning-task\nid: ${cursor}\ndata: ${JSON.stringify({ version: 2, taskId, cursor, payload: { type: "practice.preview", section: "feedback", sequence: cursor, text: "你好 🙂" } })}\n\n`;
describe("platform-independent task SSE decoding", () => {
  it("accepts every string boundary, CRLF, comments and ignores replayed cursors", () => {
    const source = ": keepalive\n\n" + event(1) + event(1) + event(2);
    for (let split = 0; split <= source.length; split++) {
      const parser = createLearningTaskSseDecoder(id);
      const values = [...parser.push(source.slice(0, split)), ...parser.push(source.slice(split))];
      parser.finish();
      expect(values).toHaveLength(2);
    }
    expect(createLearningTaskSseDecoder(id).push(event(1).replaceAll("\n", "\r\n"))).toHaveLength(
      1,
    );
  });
  it("rejects cross-task events, missing cursors, duplicate fields and truncated streams", () => {
    for (const frame of [
      event(2),
      event(1, "00000000-0000-4000-8000-000000000002"),
      event(1).replace("id: 1", "id: 1\nid: 1"),
    ])
      expect(() => createLearningTaskSseDecoder(id).push(frame)).toThrow();
    const parser = createLearningTaskSseDecoder(id);
    parser.push(event(1).slice(0, -1));
    expect(() => parser.finish()).toThrow();
  });
});
