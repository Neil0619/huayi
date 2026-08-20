import type { Page } from "@playwright/test";

import type { GoogleAuthenticationSeed } from "./cloud-browser-authority-google-authentication.js";
import type { PracticeAuthoritySeed } from "./cloud-browser-authority-practice.js";

export interface CloudBrowserAuthoritySeed {
  readonly authenticated: boolean;
  readonly seed:
    | "candidate-analysis"
    | "analysis-history-maintenance"
    | "completed-practice-history"
    | "empty"
    | GoogleAuthenticationSeed
    | "invitation-onboarding"
    | "operator-console"
    | "password-authentication"
    | "password-recovery"
    | "password-only-sign-in-methods"
    | "google-only-sign-in-methods"
    | "stale-password-sign-in-methods"
    | "unregistered-password-login"
    | "platform-query-quota"
    | "pending-pairing-approval"
    | "semantic-duplicate-suggestions"
    | PracticeAuthoritySeed;
}

export interface CloudBrowserAuthoritySnapshot {
  readonly analysisCount: number;
  readonly captureCount: number;
  readonly duplicateSuggestionProviderCallCount: number;
  readonly extensionQueryCount: number;
  readonly extensionSessionCount: number;
  readonly importCount: number;
  readonly itemCount: number;
  readonly securityNotificationCount: number;
  readonly practiceProviderCallCount: number;
  readonly practiceHistoryCount: number;
  readonly requestFacts: readonly {
    readonly authenticatedAs: "extension" | "none" | "web";
    readonly method: string;
    readonly path: string;
    readonly proof: "read" | "write-invalid" | "write-valid";
  }[];
  readonly webSessionCount: number;
  readonly wordCopyCount: number;
  readonly wordCount: number;
  readonly wordImportCount: number;
  readonly wordbookJobCount: number;
}

export interface CloudBrowserAuthority {
  install(page: Page): Promise<void>;
  markLearningItemPracticed(id: string): void;
  snapshot(): CloudBrowserAuthoritySnapshot;
}

export type CloudBrowserRequestFact = CloudBrowserAuthoritySnapshot["requestFacts"][number];
export type CloudBrowserAuthenticatedAs = CloudBrowserRequestFact["authenticatedAs"];
