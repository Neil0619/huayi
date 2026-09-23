export interface AsbplayerOfficialBrowserOptions {
  executablePath?: string;
  denyLocalFonts: boolean;
  commonPopupWindow: boolean;
}

export function asbplayerOfficialBrowserOptions(
  arguments_: string[],
  options?: { supportsPopupWindow?: boolean },
): AsbplayerOfficialBrowserOptions;
