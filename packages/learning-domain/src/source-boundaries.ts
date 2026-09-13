/** A source position must not cut a UTF-16 surrogate pair in half. */
export function splitsSurrogatePair(source: string, offset: number): boolean {
  const before = source.charCodeAt(offset - 1);
  const after = source.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}
