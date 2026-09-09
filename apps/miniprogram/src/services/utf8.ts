/** WeChat JSCore does not consistently expose TextDecoder. Keep at most 3 tail bytes. */
export function createUtf8Decoder() {
  let tail: number[] = [];
  return {
    push(chunk: Uint8Array) {
      const bytes = tail.length ? Uint8Array.from([...tail, ...chunk]) : chunk;
      tail = [];
      let text = "";
      for (let i = 0; i < bytes.length;) {
        const first = bytes[i] ?? 0;
        const length =
          first < 0x80
            ? 1
            : first >= 0xc2 && first <= 0xdf
              ? 2
              : first >= 0xe0 && first <= 0xef
                ? 3
                : first >= 0xf0 && first <= 0xf4
                  ? 4
                  : 0;
        if (!length) throw new Error("Invalid UTF-8");
        if (i + length > bytes.length) {
          tail = Array.from(bytes.slice(i));
          break;
        }
        let point = first & (length === 1 ? 0x7f : length === 2 ? 0x1f : length === 3 ? 0xf : 7);
        for (let j = 1; j < length; j++) {
          const next = bytes[i + j] ?? 0;
          if ((next & 0xc0) !== 0x80) throw new Error("Invalid UTF-8");
          point = (point << 6) | (next & 0x3f);
        }
        if (
          (length === 2 && point < 0x80) ||
          (length === 3 && point < 0x800) ||
          (length === 4 && point < 0x10000) ||
          point > 0x10ffff ||
          (point >= 0xd800 && point <= 0xdfff)
        )
          throw new Error("Invalid UTF-8");
        text += String.fromCodePoint(point);
        i += length;
      }
      return text;
    },
    finish() {
      if (tail.length) throw new Error("Incomplete UTF-8");
      return "";
    },
  };
}
