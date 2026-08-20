export interface PasswordRecoveryRoute {
  clearUrl: boolean;
  continuation: boolean;
}

export function parsePasswordRecoveryRoute(
  pathname: string,
  search: string,
): PasswordRecoveryRoute | undefined {
  if (pathname !== "/recover") return undefined;
  return {
    clearUrl: search !== "",
    continuation: search === "?continue=1",
  };
}
