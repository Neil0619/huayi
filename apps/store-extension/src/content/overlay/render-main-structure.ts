// Model text stays text. Quotes protect punctuation in English examples from clause splitting.
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
      if (stack.length === 0) return index + 1;
    } else if (quotePairs[character]) {
      stack.push(quotePairs[character]);
    }
  }
  return text.length;
}

function appendMarked(paragraph: HTMLElement, value: string, quote = false): void {
  const node = paragraph.ownerDocument.createElement(quote ? "span" : "strong");
  node.className = quote ? "structure-quote" : "structure-label";
  node.textContent = value;
  paragraph.append(node);
}

export function renderMainStructure(section: HTMLElement, text: string): void {
  if (text.length === 0) return;
  const createClause = (): HTMLParagraphElement => {
    const paragraph = section.ownerDocument.createElement("p");
    paragraph.className = "structure-clause";
    section.append(paragraph);
    return paragraph;
  };
  let paragraph = createClause();
  // A leading newline forms its own blank clause, so it cannot receive the main-clause accent.
  if (/^[^\S\n]*主句(?=为|是|：|:)/u.test(text)) paragraph.dataset.structureMain = "";
  // Scan quotes, grammar terms and clause boundaries together, preserving all intervening text.
  const tokens =
    /["'“‘；;。\n，]|主句|主语|谓语|系动词|表语|宾语从句|宾语|定语从句|条件状语从句|状语从句|状语|同位语/gu;
  let start = 0;
  let clauseStart = 0;
  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    const value = match[0];
    paragraph.append(text.slice(start, match.index));
    start = match.index + value.length;
    if (
      quotePairs[value] &&
      (value !== "'" || !/[\p{L}\p{N}]/u.test(text[match.index - 1] ?? ""))
    ) {
      start = quoteEnd(text, match.index);
      const quoted = text.slice(match.index, start);
      if (quotePairs[value] === text[start - 1] && /[a-z]/iu.test(quoted)) {
        appendMarked(paragraph, quoted, true);
      } else {
        // Chinese and incomplete quotes also remain untouched by grammar-term emphasis.
        paragraph.append(quoted);
      }
    } else if (value.length > 1) {
      appendMarked(paragraph, value);
    } else {
      paragraph.append(value);
      if (/[；;。\n]/u.test(value) || (value === "，" && match.index - clauseStart >= 24)) {
        const whitespace = /^\s*/u.exec(text.slice(start))?.[0] ?? "";
        paragraph.append(whitespace);
        start += whitespace.length;
        clauseStart = start;
        if (start < text.length) paragraph = createClause();
      }
    }
    tokens.lastIndex = start;
  }
  paragraph.append(text.slice(start));
}
