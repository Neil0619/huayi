const maximumCharacters = 48 * 1024;
const maximumBytes = 128 * 1024;

export function isStructuredPayloadWithinBudget(value: object): boolean {
  const serialized = JSON.stringify(value);
  let bytes = 0;
  for (const character of serialized) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > maximumBytes) break;
  }
  return serialized.length <= maximumCharacters && bytes <= maximumBytes;
}
