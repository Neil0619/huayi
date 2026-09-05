import { parse } from "tldts";

import {
  canonicalStoreSiteHostname,
  storeSitePolicySchema,
  storeSiteRuleSchema,
  type StoreSitePolicy,
  type StoreSiteRule,
} from "./settings.js";

export type StoreSiteRuleKey = Pick<StoreSiteRule, "hostname" | "includeSubdomains">;
export type SiteRuleUrlParser = (input: string) => {
  readonly hostname: string;
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
};

export function normalizeStoreSiteRule(
  rule: StoreSiteRule,
  parseUrl: SiteRuleUrlParser,
): StoreSiteRule {
  const input = rule.hostname.trim();
  if (
    input.length === 0 ||
    input.includes("*") ||
    /^[\\/]/u.test(input) ||
    /^https?:(?!\/\/)/iu.test(input)
  ) {
    throw new TypeError("Invalid site hostname.");
  }
  const url = parseUrl(/^[a-z][a-z\d+.-]*:\/\//iu.test(input) ? input : `https://${input}`);
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    throw new TypeError("Invalid site URL.");
  }
  const hostname = canonicalStoreSiteHostname(url.hostname);
  const parsed = parse(hostname, { allowPrivateDomains: true });
  if (hostname !== "localhost" && !parsed.isIp && parsed.domain === null) {
    throw new TypeError("Invalid site hostname.");
  }
  return validateRule({ ...rule, hostname });
}

function validateRule(rule: StoreSiteRule): StoreSiteRule {
  const hostname = canonicalStoreSiteHostname(rule.hostname);
  const parsed = parse(hostname, { allowPrivateDomains: true });
  const local = hostname === "localhost" || parsed.isIp === true;
  if (
    (!local &&
      (parsed.hostname === null ||
        hostname
          .split(".")
          .some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u.test(label)))) ||
    (rule.includeSubdomains && (local || parsed.domain === null))
  ) {
    throw new TypeError("Invalid site scope.");
  }
  return storeSiteRuleSchema.parse({ ...rule, hostname });
}

export function sameStoreSiteRule(left: StoreSiteRuleKey, right: StoreSiteRuleKey): boolean {
  return (
    canonicalStoreSiteHostname(left.hostname) === canonicalStoreSiteHostname(right.hostname) &&
    left.includeSubdomains === right.includeSubdomains
  );
}

function ruleKey(rule: StoreSiteRuleKey): string {
  return `${rule.hostname}\u0000${String(rule.includeSubdomains)}`;
}

export function upsertStoreSiteRule(
  policy: StoreSitePolicy,
  rule: StoreSiteRule,
  previous?: StoreSiteRuleKey,
): StoreSitePolicy {
  const normalized = validateRule(rule);
  const rules = policy.rules.filter(
    (current) =>
      !sameStoreSiteRule(current, normalized) &&
      (previous === undefined || !sameStoreSiteRule(current, previous)),
  );
  rules.push(normalized);
  rules.sort((left, right) => (ruleKey(left) < ruleKey(right) ? -1 : 1));
  return storeSitePolicySchema.parse({ ...policy, rules });
}
