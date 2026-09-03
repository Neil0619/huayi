// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface CssDeclaration {
  property: string;
  selector: string;
  value: string;
}

interface CssSource {
  content: string;
  path: string;
}

const requiredCapture = (capture: string | undefined): string => {
  if (capture === undefined) {
    throw new Error("Expected CSS contract capture is missing.");
  }
  return capture;
};

const webSourceDirectory = fileURLToPath(new URL(".", import.meta.url));
const mainSource = readFileSync(join(webSourceDirectory, "main.tsx"), "utf8");
const productionStyleNames = Array.from(
  mainSource.matchAll(/^import "\.\/([^"\n]+\.css)";$/gmu),
  ([, path]) => requiredCapture(path),
);
const productionStyles = productionStyleNames.map<CssSource>((name) => ({
  content: readFileSync(join(webSourceDirectory, name), "utf8"),
  path: `apps/web/src/${name}`,
}));

const styleContent = new Map(productionStyles.map(({ content, path }) => [path, content]));
const styles = styleContent.get("apps/web/src/styles.css") ?? "";
const analysisStyles = styleContent.get("apps/web/src/analysis-page.css") ?? "";
const libraryStyles = styleContent.get("apps/web/src/library-page.css") ?? "";
const practiceStyles = styleContent.get("apps/web/src/practice-page.css") ?? "";
const adminStyles = styleContent.get("apps/web/src/admin-operations-page.css") ?? "";
const privacyStyles = styleContent.get("apps/web/src/privacy-page.css") ?? "";

const parseDeclarations = (content: string): CssDeclaration[] => {
  const declarations: CssDeclaration[] = [];
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//gu, "");

  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/gsu)) {
    const selector = match[1]?.trim() ?? "";
    const body = match[2] ?? "";

    for (const candidate of body.split(";")) {
      const separatorIndex = candidate.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }
      const property = candidate.slice(0, separatorIndex).trim();
      const value = candidate.slice(separatorIndex + 1).trim();
      if (property.length > 0 && value.length > 0) {
        declarations.push({ property, selector, value });
      }
    }
  }

  return declarations;
};

const registryDefinitions = new Set(
  parseDeclarations(styles)
    .filter(({ property, selector }) => selector === ":root" && property.startsWith("--"))
    .map(({ property }) => property),
);
const primitiveSection = styles
  .split("/* Primitive tokens */")[1]
  ?.split("/* Semantic tokens */")[0];
const primitiveDefinitions = new Set(
  Array.from(primitiveSection?.matchAll(/^\s*(--[a-z0-9-]+):/gimu) ?? [], ([, token]) =>
    requiredCapture(token),
  ),
);

const tokenReferences = (value: string): string[] =>
  Array.from(value.matchAll(/var\(\s*(--[a-z0-9-]+)/giu), ([, token]) => requiredCapture(token));

const controlledProperty = new RegExp(
  [
    "^(?:color|background(?:-color)?",
    "border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?",
    "outline(?:-color)?",
    "margin(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?",
    "padding(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?",
    "gap|row-gap|column-gap|top|right|bottom|left",
    "inset(?:-(?:block|inline)(?:-(?:start|end))?)?",
    "border(?:-(?:top-left|top-right|bottom-left|bottom-right))?-radius|box-shadow)$",
  ].join("|"),
  "u",
);
const colorProperty =
  /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?)$/u;
const spatialProperty =
  /^(?:margin|padding)(?:-.+)?$|^(?:gap|row-gap|column-gap|top|right|bottom|left|inset(?:-.+)?|border(?:-.+)?-radius)$/u;
const rawColor = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\(/iu;
const rawThemeLength = /(?:^|[^a-z0-9-])(?:\d*\.\d+|[1-9]\d*)(?:rem|em|px)\b/iu;
const structuralKeywords = new Set([
  "0",
  "auto",
  "none",
  "normal",
  "transparent",
  "currentColor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

const isStructuralOnly = (value: string): boolean =>
  value
    .split(/\s+/u)
    .filter(Boolean)
    .every(
      (part) => structuralKeywords.has(part) || /^(?:\d*\.\d+|\d+)(?:%|ch|fr|vh|vw)$/u.test(part),
    );

const violatesTokenContract = ({ property, selector, value }: CssDeclaration): boolean => {
  if (property.startsWith("--") || !controlledProperty.test(property)) {
    return false;
  }
  if (isStructuralOnly(value)) {
    return false;
  }

  const references = tokenReferences(value);
  if (colorProperty.test(property)) {
    return (
      references.length === 0 ||
      rawColor.test(value) ||
      (selector !== ":root" && references.some((token) => primitiveDefinitions.has(token)))
    );
  }
  if (property === "box-shadow") {
    return !/^var\(--[a-z0-9-]+\)$/iu.test(value);
  }
  if (spatialProperty.test(property)) {
    const withoutReferences = value.replace(/var\([^)]*\)/giu, "");
    return references.length === 0 || rawThemeLength.test(withoutReferences);
  }

  return false;
};

describe("Web design token contract", () => {
  it("keeps every production CSS token reference closed over the root registry", () => {
    const unknownReferences = productionStyles.flatMap(({ content, path }) =>
      parseDeclarations(content).flatMap(({ property, value }) =>
        tokenReferences(value)
          .filter((token) => !registryDefinitions.has(token))
          .map((token) => `${path}: ${property} -> ${token}`),
      ),
    );

    expect(unknownReferences).toEqual([]);
  });

  it("routes production theme properties through tokens", () => {
    const violations = productionStyles.flatMap(({ content, path }) =>
      parseDeclarations(content)
        .filter(violatesTokenContract)
        .map(({ property, selector, value }) => `${path}: ${selector} { ${property}: ${value} }`),
    );

    expect(violations).toEqual([]);
  });
});

describe("Web responsive style contract", () => {
  it("keeps workspace headings compact enough for long Chinese labels", () => {
    expect(styles).toMatch(
      /\.page-heading h1\s*\{[^}]*font-size:\s*clamp\(2\.25rem,\s*3\.6vw,\s*3\.75rem\)/isu,
    );
    expect(styles).not.toContain("font-size: clamp(3rem, 5.7vw, 5.15rem)");
  });

  it("stacks hosted acceptance and workspace navigation without overlap", () => {
    expect(styles).toContain("--acceptance-notice-height: 42px");
    expect(styles).toMatch(
      /body:has\(\.acceptance-environment-notice\)\s+\.workspace-navigation\s*\{[^}]*top:\s*calc\(/isu,
    );
  });

  it("keeps the App Shell on semantic tokens at the narrow-screen boundary", () => {
    expect(styles).toContain("/* Primitive tokens */");
    expect(styles).toContain("/* Semantic tokens */");
    expect(styles).toContain("/* Component tokens */");
    expect(styles).toContain("@media (max-width: 48rem)");
    expect(styles).toMatch(/\.inbox-layout\s*\{[^}]*grid-template-columns:\s*1fr/isu);
  });

  it("removes meaningful transition time when reduced motion is requested", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("transition-duration: 0.01ms !important");
  });

  it("stacks the pasted-analysis form and stream at the shared narrow boundary", () => {
    expect(analysisStyles).toContain("@media (max-width: 48rem)");
    expect(analysisStyles).toMatch(
      /\.analysis-compose-layout,\s*\.analysis-options\s*\{[^}]*grid-template-columns:\s*1fr/isu,
    );
  });

  it("stacks library filters and detail at the shared narrow boundary", () => {
    expect(libraryStyles).toContain("@media (max-width: 48rem)");
    expect(libraryStyles).toMatch(
      /\.library-filters,\s*\.library-layout\s*\{[^}]*grid-template-columns:\s*1fr/isu,
    );
  });

  it("stacks practice targets and disables meaningful practice motion", () => {
    expect(practiceStyles).toContain("@media (max-width: 48rem)");
    expect(practiceStyles).toMatch(
      /\.practice-queue > div\s*\{[^}]*grid-template-columns:\s*1fr/isu,
    );
    expect(practiceStyles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("stacks operator grids and removes meaningful console motion", () => {
    expect(adminStyles).toContain("@media (max-width: 60rem)");
    expect(adminStyles).toMatch(
      /\.admin-metrics,\s*\.admin-user-grid,\s*\.admin-split\s*\{[^}]*grid-template-columns:\s*1fr/isu,
    );
    expect(adminStyles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps the public privacy notice readable at 20rem and reduced motion", () => {
    expect(privacyStyles).toContain("max-width: 72ch");
    expect(privacyStyles).toContain("@media (max-width: 32rem)");
    expect(privacyStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(privacyStyles).toContain("overflow-wrap: anywhere");
  });
});
