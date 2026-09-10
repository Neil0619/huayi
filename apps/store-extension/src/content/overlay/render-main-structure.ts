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

function opensQuote(text: string, index: number): boolean {
  const character = text[index];
  return (
    character === "“" ||
    character === "‘" ||
    character === '"' ||
    (character === "'" && !/[\p{L}\p{N}]/u.test(text[index - 1] ?? ""))
  );
}

function clauses(text: string): string[] {
  const values: string[] = [];
  let start = 0;
  let boundary = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (boundary && !/\s/u.test(character)) {
      values.push(text.slice(start, index));
      start = index;
      boundary = false;
    }
    if (opensQuote(text, index)) index = quoteEnd(text, index) - 1;
    else if (/[；;。\n]/u.test(character) || (character === "，" && index - start >= 24))
      boundary = true;
  }
  if (start < text.length) values.push(text.slice(start));
  return values;
}

function appendExplanation(paragraph: HTMLElement, value: string): void {
  const document = paragraph.ownerDocument;
  const terms =
    /主句|主语|谓语|系动词|表语|宾语从句|宾语|定语从句|条件状语从句|状语从句|状语|同位语/gu;
  let start = 0;
  for (const match of value.matchAll(terms)) {
    paragraph.append(document.createTextNode(value.slice(start, match.index)));
    const strong = document.createElement("strong");
    strong.className = "structure-label";
    strong.textContent = match[0];
    paragraph.append(strong);
    start = match.index + match[0].length;
  }
  paragraph.append(document.createTextNode(value.slice(start)));
}

function appendClause(paragraph: HTMLElement, value: string): void {
  const document = paragraph.ownerDocument;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (!opensQuote(value, index)) continue;
    const end = quoteEnd(value, index);
    const quoted = value.slice(index, end);
    const closed = quotePairs[value[index] ?? ""] === value[end - 1];
    appendExplanation(paragraph, value.slice(start, index));
    if (closed && /[a-z]/iu.test(quoted)) {
      const span = document.createElement("span");
      span.className = "structure-quote";
      span.textContent = quoted;
      paragraph.append(span);
    } else {
      // Chinese and incomplete quotes also remain untouched by grammar-term emphasis.
      paragraph.append(document.createTextNode(quoted));
    }
    start = end;
    index = end - 1;
  }
  appendExplanation(paragraph, value.slice(start));
}

export function renderMainStructure(section: HTMLElement, text: string): void {
  for (const [index, value] of clauses(text).entries()) {
    const paragraph = section.ownerDocument.createElement("p");
    paragraph.className = "structure-clause";
    if (index === 0 && /^\s*主句(?=为|是|：|:)/u.test(value)) {
      paragraph.dataset.structureMain = "";
    }
    appendClause(paragraph, value);
    section.append(paragraph);
  }
}
