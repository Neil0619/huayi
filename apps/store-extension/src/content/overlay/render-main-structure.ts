// Only explicit declarations at a logical boundary can supply a primary clause.
// Everything else remains verbatim explanation; model text never becomes HTML.
const quotePairs: Readonly<Record<string, string>> = { '"': '"', "'": "'", "“": "”", "‘": "’" };

function quoteEnd(text: string, start: number): number {
  const stack = [quotePairs[text[start] ?? ""]];
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if ((character === "'" || character === "’") && /[\p{L}\p{N}]/u.test(text[index - 1] ?? "")) {
      if (/[\p{L}\p{N}]/u.test(text[index + 1] ?? "") || stack.at(-1) !== character) continue;
    }
    if (character === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return index;
    } else if (quotePairs[character]) {
      stack.push(quotePairs[character]);
    }
  }
  return -1;
}

export function renderMainStructure(section: HTMLElement, text: string): void {
  const node = (tag: string, className = "", ...content: (string | Node)[]): HTMLElement => {
    const element = section.ownerDocument.createElement(tag);
    element.className = className;
    element.append(...content);
    return element;
  };
  const primary = node("div", "cores");
  const explanation = node("div", "notes");
  const paragraph = (value: string): void => {
    explanation.append(node("p", "", value));
  };
  let start = 0;
  const tokens = /["'“‘]|[；;。\n]\s*/gu;
  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    const index = match.index;
    const character = match[0];
    if (quotePairs[character] && (character !== "'" || !/\w/u.test(text[index - 1] ?? ""))) {
      const end = quoteEnd(text, index);
      if (end < 0) break;
      const declaration = /^(第[一二三四五六七八九十百\d]+句)?(主[句干])(?:为|是|[：:])\s*$/u.exec(
        text.slice(start, index).trim(),
      );
      const core = text.slice(index + 1, end);
      if (declaration && /[a-z]/iu.test(core)) {
        primary.append(
          node(
            "p",
            "core",
            node("small", "", declaration[1] ?? declaration[2] ?? ""),
            node("strong", "", core),
          ),
        );
      }
      tokens.lastIndex = end + 1;
    } else if (!quotePairs[character]) {
      paragraph(text.slice(start, tokens.lastIndex));
      start = tokens.lastIndex;
    }
  }
  if (start < text.length) paragraph(text.slice(start));
  if (primary.childElementCount === 0) {
    section.append(explanation);
    return;
  }
  section.append(primary, node("details", "", node("summary", "", "查看结构说明"), explanation));
}

// Keep the live disclosure and summary attached so streaming cannot steal focus.
export function reconcileMainStructure(current: HTMLElement, rendered: HTMLElement): boolean {
  if (!current.querySelector("details") || !rendered.querySelector("details")) return false;
  for (const selector of [".cores", ".notes"]) {
    current.querySelector(selector)?.replaceWith(...rendered.querySelectorAll(selector));
  }
  return true;
}
