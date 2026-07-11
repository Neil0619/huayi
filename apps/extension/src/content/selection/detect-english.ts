const HAN_CHARACTER_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_LETTER_PATTERN = /[A-Za-z]/;

export function normalizeSelectionText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v\u00a0 ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isEnglishText(value: string): boolean {
  const normalized = normalizeSelectionText(value);
  return LATIN_LETTER_PATTERN.test(normalized) && !HAN_CHARACTER_PATTERN.test(normalized);
}
