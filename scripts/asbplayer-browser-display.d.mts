export interface AsbplayerBrowserDisplay {
  expectedScale: number;
  launchOptions: {
    headless: false;
    viewport: null;
    args: string[];
  };
}

export function asbplayerBrowserDisplay(
  environment?: Record<string, string | undefined>,
  platform?: string,
): AsbplayerBrowserDisplay | undefined;

export function verifyNativeDisplay(
  display: AsbplayerBrowserDisplay,
  metrics: { scale: number },
): void;
