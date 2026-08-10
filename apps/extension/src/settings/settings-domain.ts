export type DefaultAction = "ask" | "explain" | "translate";
export type SiteAction = "allow" | "block";

export interface KeyboardShortcut {
  alt: boolean;
  code: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export interface SiteRule {
  action: SiteAction;
  hostname: string;
  includeSubdomains: boolean;
}

export interface ExtensionSettings {
  defaultAction: DefaultAction;
  enabled: boolean;
  settingsVersion: 1;
  sitePolicy: {
    defaultAction: SiteAction;
    rules: SiteRule[];
  };
  wordbook: {
    automaticSync: boolean;
    enabled: boolean;
    syncHour: number;
  };
  youtube: {
    defaultBilingual: boolean;
    enabled: boolean;
    shortcut: KeyboardShortcut | null;
  };
}

export interface ParsedStoredSettings {
  settings: ExtensionSettings;
  status: "defaulted" | "invalid" | "valid";
}

export type SettingsMutation =
  | { enabled: boolean; type: "set-enabled" }
  | { action: DefaultAction; type: "set-default-action" }
  | { action: SiteAction; type: "set-site-default" }
  | { rule: SiteRule; type: "upsert-site-rule" }
  | { hostname: string; type: "remove-site-rule" }
  | { values: Partial<ExtensionSettings["wordbook"]>; type: "set-wordbook" }
  | { values: Partial<ExtensionSettings["youtube"]>; type: "set-youtube" }
  | { type: "reset" };

export const MAX_SITE_RULES = 200;

export const DEFAULT_YOUTUBE_SHORTCUT: KeyboardShortcut = {
  alt: false,
  code: "KeyZ",
  ctrl: false,
  meta: false,
  shift: true,
};

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  defaultAction: "ask",
  enabled: true,
  settingsVersion: 1,
  sitePolicy: {
    defaultAction: "allow",
    rules: [],
  },
  wordbook: {
    automaticSync: true,
    enabled: true,
    syncHour: 8,
  },
  youtube: {
    defaultBilingual: false,
    enabled: true,
    shortcut: DEFAULT_YOUTUBE_SHORTCUT,
  },
};

const FAIL_CLOSED_SETTINGS: ExtensionSettings = {
  ...DEFAULT_EXTENSION_SETTINGS,
  enabled: false,
  sitePolicy: { defaultAction: "block", rules: [] },
  wordbook: { ...DEFAULT_EXTENSION_SETTINGS.wordbook, automaticSync: false, enabled: false },
  youtube: { ...DEFAULT_EXTENSION_SETTINGS.youtube, enabled: false },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function optionalBoolean(value: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const candidate = value[key];
  if (candidate === undefined) return fallback;
  if (typeof candidate !== "boolean") throw new TypeError(`${key} must be a boolean.`);
  return candidate;
}

function optionalEnum<Value extends string>(
  value: Record<string, unknown>,
  key: string,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const candidate = value[key];
  if (candidate === undefined) return fallback;
  if (typeof candidate !== "string" || !allowed.includes(candidate as Value)) {
    throw new TypeError(`${key} is invalid.`);
  }
  return candidate as Value;
}

function parseSiteRule(value: unknown): SiteRule {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["action", "hostname", "includeSubdomains"]) ||
    typeof value.hostname !== "string" ||
    typeof value.includeSubdomains !== "boolean" ||
    (value.action !== "allow" && value.action !== "block")
  ) {
    throw new TypeError("Site rule is invalid.");
  }
  const hostname = normalizeSiteRuleInput(value.hostname);
  if (hostname !== value.hostname) throw new TypeError("Stored hostname is not normalized.");
  return { action: value.action, hostname, includeSubdomains: value.includeSubdomains };
}

function parseSitePolicy(value: unknown): ExtensionSettings["sitePolicy"] {
  if (value === undefined) return { ...DEFAULT_EXTENSION_SETTINGS.sitePolicy, rules: [] };
  if (!isRecord(value) || !hasOnlyKeys(value, ["defaultAction", "rules"])) {
    throw new TypeError("Site policy is invalid.");
  }
  const rawRules = value.rules ?? [];
  if (!Array.isArray(rawRules) || rawRules.length > MAX_SITE_RULES) {
    throw new TypeError("Site rules are invalid.");
  }
  const rules = rawRules.map(parseSiteRule);
  if (new Set(rules.map((rule) => rule.hostname)).size !== rules.length) {
    throw new TypeError("Site rules must be unique by hostname.");
  }
  return {
    defaultAction: optionalEnum(value, "defaultAction", ["allow", "block"], "allow"),
    rules,
  };
}

function parseWordbook(value: unknown): ExtensionSettings["wordbook"] {
  if (value === undefined) return { ...DEFAULT_EXTENSION_SETTINGS.wordbook };
  if (!isRecord(value) || !hasOnlyKeys(value, ["automaticSync", "enabled", "syncHour"])) {
    throw new TypeError("Wordbook settings are invalid.");
  }
  const rawHour = value.syncHour ?? DEFAULT_EXTENSION_SETTINGS.wordbook.syncHour;
  if (typeof rawHour !== "number" || !Number.isInteger(rawHour) || rawHour < 0 || rawHour > 23) {
    throw new TypeError("syncHour must be an integer from 0 through 23.");
  }
  return {
    automaticSync: optionalBoolean(value, "automaticSync", true),
    enabled: optionalBoolean(value, "enabled", true),
    syncHour: rawHour,
  };
}

function parseKeyboardShortcut(value: unknown): KeyboardShortcut | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["alt", "code", "ctrl", "meta", "shift"]) ||
    typeof value.alt !== "boolean" ||
    typeof value.code !== "string" ||
    typeof value.ctrl !== "boolean" ||
    typeof value.meta !== "boolean" ||
    typeof value.shift !== "boolean" ||
    !/^(?:Key[A-Z]|Digit\d|F(?:[1-9]|1\d|2[0-4]))$/u.test(value.code) ||
    (!value.alt && !value.ctrl && !value.meta && !value.shift)
  ) {
    throw new TypeError("Keyboard shortcut is invalid.");
  }
  return {
    alt: value.alt,
    code: value.code,
    ctrl: value.ctrl,
    meta: value.meta,
    shift: value.shift,
  };
}

function parseYouTube(value: unknown): ExtensionSettings["youtube"] {
  if (value === undefined) return { ...DEFAULT_EXTENSION_SETTINGS.youtube };
  if (!isRecord(value) || !hasOnlyKeys(value, ["defaultBilingual", "enabled", "shortcut"])) {
    throw new TypeError("YouTube settings are invalid.");
  }
  return {
    defaultBilingual: optionalBoolean(value, "defaultBilingual", false),
    enabled: optionalBoolean(value, "enabled", true),
    shortcut:
      value.shortcut === undefined
        ? { ...DEFAULT_YOUTUBE_SHORTCUT }
        : parseKeyboardShortcut(value.shortcut),
  };
}

export function parseStoredSettings(value: unknown): ParsedStoredSettings {
  if (value === undefined) {
    return { settings: DEFAULT_EXTENSION_SETTINGS, status: "defaulted" };
  }
  try {
    if (
      !isRecord(value) ||
      value.settingsVersion !== 1 ||
      !hasOnlyKeys(value, [
        "defaultAction",
        "enabled",
        "settingsVersion",
        "sitePolicy",
        "wordbook",
        "youtube",
      ])
    ) {
      throw new TypeError("Stored settings are invalid.");
    }
    return {
      settings: {
        defaultAction: optionalEnum(value, "defaultAction", ["ask", "explain", "translate"], "ask"),
        enabled: optionalBoolean(value, "enabled", true),
        settingsVersion: 1,
        sitePolicy: parseSitePolicy(value.sitePolicy),
        wordbook: parseWordbook(value.wordbook),
        youtube: parseYouTube(value.youtube),
      },
      status: "valid",
    };
  } catch {
    return { settings: FAIL_CLOSED_SETTINGS, status: "invalid" };
  }
}

export function normalizeSiteRuleInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.includes("*")) throw new TypeError("Enter a hostname.");
  const hasScheme = /^[A-Za-z][A-Za-z\d+.-]*:/u.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch (error) {
    throw new TypeError("Enter a valid HTTP(S) hostname.", { cause: error });
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new TypeError("Enter a public HTTP(S) hostname without credentials.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length === 0 || label.length > 63 || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/u.test(label),
    )
  ) {
    throw new TypeError("Enter a registrable hostname.");
  }
  return hostname;
}

function ruleMatches(hostname: string, rule: SiteRule): boolean {
  return (
    hostname === rule.hostname || (rule.includeSubdomains && hostname.endsWith(`.${rule.hostname}`))
  );
}

export function evaluatePageAccess(url: URL, settings: ExtensionSettings): SiteAction {
  if (!settings.enabled || (url.protocol !== "http:" && url.protocol !== "https:")) return "block";
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  const match = settings.sitePolicy.rules
    .filter((rule) => ruleMatches(hostname, rule))
    .sort((left, right) => right.hostname.split(".").length - left.hostname.split(".").length)[0];
  return match?.action ?? settings.sitePolicy.defaultAction;
}

export function parseSettingsMutation(value: unknown): SettingsMutation | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "reset" && hasOnlyKeys(value, ["type"])) return { type: "reset" };
  if (
    value.type === "set-enabled" &&
    hasOnlyKeys(value, ["enabled", "type"]) &&
    typeof value.enabled === "boolean"
  ) {
    return { enabled: value.enabled, type: "set-enabled" };
  }
  if (
    value.type === "set-default-action" &&
    hasOnlyKeys(value, ["action", "type"]) &&
    (value.action === "ask" || value.action === "explain" || value.action === "translate")
  ) {
    return { action: value.action, type: "set-default-action" };
  }
  if (
    value.type === "set-site-default" &&
    hasOnlyKeys(value, ["action", "type"]) &&
    (value.action === "allow" || value.action === "block")
  ) {
    return { action: value.action, type: "set-site-default" };
  }
  if (value.type === "upsert-site-rule" && hasOnlyKeys(value, ["rule", "type"])) {
    try {
      return { rule: parseSiteRule(value.rule), type: "upsert-site-rule" };
    } catch {
      return null;
    }
  }
  if (
    value.type === "remove-site-rule" &&
    hasOnlyKeys(value, ["hostname", "type"]) &&
    typeof value.hostname === "string"
  ) {
    try {
      return { hostname: normalizeSiteRuleInput(value.hostname), type: "remove-site-rule" };
    } catch {
      return null;
    }
  }
  if (value.type === "set-wordbook" && hasOnlyKeys(value, ["type", "values"])) {
    try {
      if (!isRecord(value.values)) return null;
      const values = parseWordbook(value.values);
      return {
        type: "set-wordbook",
        values: Object.fromEntries(
          Object.keys(value.values).map((key) => [key, values[key as keyof typeof values]]),
        ),
      };
    } catch {
      return null;
    }
  }
  if (value.type === "set-youtube" && hasOnlyKeys(value, ["type", "values"])) {
    try {
      if (!isRecord(value.values)) return null;
      const values = parseYouTube(value.values);
      return {
        type: "set-youtube",
        values: Object.fromEntries(
          Object.keys(value.values).map((key) => [key, values[key as keyof typeof values]]),
        ),
      };
    } catch {
      return null;
    }
  }
  return null;
}
