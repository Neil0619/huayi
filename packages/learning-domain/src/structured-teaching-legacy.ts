import type { SentenceStructure } from "./teaching-structure.js";

export function boundedLegacyText(text: string, maximum: number): string {
  if (text.length <= maximum) return text;
  const suffix = "\n（兼容视图已省略部分结构）";
  let prefix = "";
  for (const character of text) {
    if (prefix.length + character.length > maximum - suffix.length) break;
    prefix += character;
  }
  return prefix + suffix;
}

export function legacyStructurePoints(structure: SentenceStructure) {
  return [
    ...structure.coreClauses.map((group, index) => ({ group, label: `主干 ${index + 1}` })),
    ...structure.modifiers.map((group, index) => ({
      group,
      label: `修饰 ${index + 1} → ${group.target.kind === "core" ? "主干" : "修饰"} ${group.target.index + 1}`,
    })),
  ].map(({ group, label }) => ({
    label,
    explanationZh: boundedLegacyText(
      `${group.fragments.map((fragment) => fragment.text).join(" … ")}\n${group.explanationZh}`,
      2000,
    ),
    // A discontinuous main clause is not a continuous quotation from the source.
    ...(group.fragments.length === 1 ? { evidenceText: group.fragments[0]?.text } : {}),
  }));
}
