function readStartTag(source, start) {
  let index = start + 1;
  if (!/[A-Za-z]/u.test(source[index] ?? "")) return null;
  const nameStart = index;
  while (/[A-Za-z0-9:-]/u.test(source[index] ?? "")) index += 1;
  const name = source.slice(nameStart, index).toLowerCase();
  const attributes = [];
  while (index < source.length) {
    while (/\s/u.test(source[index] ?? "")) index += 1;
    if (source[index] === ">") return { attributes, end: index, name };
    if (source[index] === "/" && source[index + 1] === ">") {
      return { attributes, end: index + 1, name };
    }
    const attributeStart = index;
    while (index < source.length && !/[\s=/>]/u.test(source[index] ?? "")) index += 1;
    if (attributeStart === index) {
      index += 1;
      continue;
    }
    const attributeName = source.slice(attributeStart, index).toLowerCase();
    while (/\s/u.test(source[index] ?? "")) index += 1;
    let value = null;
    if (source[index] === "=") {
      index += 1;
      while (/\s/u.test(source[index] ?? "")) index += 1;
      const quote = source[index] === '"' || source[index] === "'" ? source[index] : null;
      if (quote !== null) {
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== quote) index += 1;
        value = source.slice(valueStart, index);
        if (source[index] === quote) index += 1;
      } else {
        const valueStart = index;
        while (index < source.length && !/[\s>]/u.test(source[index] ?? "")) index += 1;
        value = source.slice(valueStart, index);
      }
    }
    attributes.push({ name: attributeName, value });
  }
  return { attributes, end: source.length - 1, name };
}

function findClosingTag(lowerSource, name, start) {
  let index = lowerSource.indexOf(`</${name}`, start);
  while (index !== -1) {
    const boundary = lowerSource[index + name.length + 2];
    if (boundary === ">" || /\s/u.test(boundary ?? "")) return index;
    index = lowerSource.indexOf(`</${name}`, index + 2);
  }
  return lowerSource.length;
}

function attributeValue(tag, name) {
  return tag.attributes.find((attribute) => attribute.name === name)?.value;
}

function isExecutableScriptType(tag) {
  const type = attributeValue(tag, "type")?.trim().toLowerCase();
  if (type === undefined || type === "" || type === "module" || type === "importmap") return true;
  const mime = type.split(";", 1)[0]?.trim() ?? "";
  return /(?:java|ecma)script|jscript|livescript/u.test(mime);
}

function isLocalScriptSource(value) {
  if (value === null || value.trim() === "") return false;
  const source = value.trim();
  return !source.startsWith("//") && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(source);
}

export function auditHtml(path, contents, violations) {
  const lowerContents = contents.toLowerCase();
  const rawTextTags = new Set([
    "iframe",
    "noembed",
    "noframes",
    "script",
    "style",
    "textarea",
    "title",
  ]);
  let index = 0;
  while (index < contents.length) {
    const start = contents.indexOf("<", index);
    if (start === -1) break;
    if (contents.startsWith("<!--", start)) {
      const commentEnd = contents.indexOf("-->", start + 4);
      index = commentEnd === -1 ? contents.length : commentEnd + 3;
      continue;
    }
    const tag = readStartTag(contents, start);
    if (tag === null) {
      index = start + 1;
      continue;
    }
    if (tag.attributes.some((attribute) => /^on[a-z]/u.test(attribute.name))) {
      violations.push(`${path}: inline event handler is forbidden.`);
    }
    if (tag.name === "script") {
      const sourceAttribute = tag.attributes.find((attribute) => attribute.name === "src");
      if (sourceAttribute !== undefined && !isLocalScriptSource(sourceAttribute.value)) {
        violations.push(`${path}: remote executable code is forbidden.`);
      }
      const closingStart = findClosingTag(lowerContents, tag.name, tag.end + 1);
      const inlineBody = contents.slice(tag.end + 1, closingStart);
      if (
        sourceAttribute === undefined &&
        isExecutableScriptType(tag) &&
        inlineBody.trim() !== ""
      ) {
        violations.push(`${path}: inline executable script is forbidden.`);
      }
      index = closingStart === contents.length ? contents.length : closingStart + 2;
      continue;
    }
    if (tag.name === "link") {
      const href = attributeValue(tag, "href")?.trim() ?? "";
      if (href.startsWith("//") || /^https?:\/\//iu.test(href)) {
        violations.push(`${path}: remote executable code is forbidden.`);
      }
    }
    if (rawTextTags.has(tag.name)) {
      const closingStart = findClosingTag(lowerContents, tag.name, tag.end + 1);
      index = closingStart === contents.length ? contents.length : closingStart + 2;
      continue;
    }
    index = tag.end + 1;
  }
}
