import { describe, expect, it } from "vitest";

import {
  canonicalStoreSiteHostname,
  evaluateSiteAction,
  STORE_SITE_RULE_LIMIT,
  type StoreSitePolicy,
} from "./settings.js";
import { upsertStoreSiteRule } from "./site-rules.js";

const block = (hostname: string, includeSubdomains = false) => ({
  action: "block" as const,
  hostname,
  includeSubdomains,
});

describe("manual Store site rules", () => {
  it("keeps hostname normalization idempotent without repairing malformed repeated dots", () => {
    for (const host of ["EXAMPLE.com.", "example.com..", "example.com...", "localhost.", "[::1]"]) {
      const canonical = canonicalStoreSiteHostname(host);
      expect(canonicalStoreSiteHostname(canonical)).toBe(canonical);
    }
    expect(canonicalStoreSiteHostname("EXAMPLE.com.")).toBe("example.com");
    expect(canonicalStoreSiteHostname("example.com..")).toBe("example.com..");
  });

  it("supports root blocks, exact exceptions, and dot-boundary matching", () => {
    let policy: StoreSitePolicy = { defaultAction: "allow", rules: [block("ersoft.cn", true)] };
    policy = upsertStoreSiteRule(policy, { ...block("wiki.ersoft.cn"), action: "allow" });
    const settings = { globallyEnabled: true, sitePolicy: policy };
    for (const host of ["ersoft.cn", "pm.ersoft.cn", "child.wiki.ersoft.cn"]) {
      expect(evaluateSiteAction(settings, host)).toBe("block");
    }
    for (const host of ["wiki.ersoft.cn", "notersoft.cn", "ersoft.cn.example.com"]) {
      expect(evaluateSiteAction(settings, host)).toBe("allow");
    }
    expect(evaluateSiteAction({ ...settings, globallyEnabled: false }, "wiki.ersoft.cn")).toBe(
      "block",
    );
  });

  it("upserts without duplicates and replaces scope atomically with schema ordering", () => {
    const previous = block("docs.example.com");
    let policy: StoreSitePolicy = { defaultAction: "allow", rules: [previous] };
    policy = upsertStoreSiteRule(policy, { ...previous, includeSubdomains: true }, previous);
    policy = upsertStoreSiteRule(policy, block("a-1.example.com"));
    policy = upsertStoreSiteRule(policy, block("a.example.com"));
    policy = upsertStoreSiteRule(policy, block("a-1.example.com"));
    expect(policy.rules.map((rule) => rule.hostname)).toEqual([
      "a-1.example.com",
      "a.example.com",
      "docs.example.com",
    ]);
    expect(policy.rules[2]?.includeSubdomains).toBe(true);
  });

  it("preserves historical terminal-dot rules with canonical priority and duplicate replacement", () => {
    const policy: StoreSitePolicy = {
      defaultAction: "allow",
      rules: [block("example.com.", true), { ...block("wiki.example.com."), action: "allow" }],
    };
    const settings = { globallyEnabled: true, sitePolicy: policy };
    expect(evaluateSiteAction(settings, "docs.example.com")).toBe("block");
    expect(evaluateSiteAction(settings, "wiki.example.com")).toBe("allow");
    expect(evaluateSiteAction(settings, "child.wiki.example.com.")).toBe("block");
    expect(evaluateSiteAction(settings, "notexample.com.")).toBe("allow");
    const updated = upsertStoreSiteRule(policy, block("wiki.example.com"));
    expect(updated.rules).toHaveLength(2);
    expect(updated.rules[1]).toEqual(block("wiki.example.com"));
    expect(policy.rules[1]?.hostname).toBe("wiki.example.com.");
  });

  it("allows replacing at the limit but never silently drops existing rules", () => {
    const policy = {
      defaultAction: "allow" as const,
      rules: Array.from({ length: STORE_SITE_RULE_LIMIT }, (_, index) =>
        block(`site${String(index).padStart(3, "0")}.example.com`),
      ),
    };
    expect(() => upsertStoreSiteRule(policy, block("extra.example.com"))).toThrow();
    expect(
      upsertStoreSiteRule(policy, { ...block("site000.example.com"), action: "allow" }).rules,
    ).toHaveLength(STORE_SITE_RULE_LIMIT);
  });
});
