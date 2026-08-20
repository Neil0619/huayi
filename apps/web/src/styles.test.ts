// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync("apps/web/src/styles.css", "utf8");
const analysisStyles = readFileSync("apps/web/src/analysis-page.css", "utf8");
const libraryStyles = readFileSync("apps/web/src/library-page.css", "utf8");
const practiceStyles = readFileSync("apps/web/src/practice-page.css", "utf8");
const adminStyles = readFileSync("apps/web/src/admin-operations-page.css", "utf8");
const privacyStyles = readFileSync("apps/web/src/privacy-page.css", "utf8");

describe("Web responsive style contract", () => {
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
