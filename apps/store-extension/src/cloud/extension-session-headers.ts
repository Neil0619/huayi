const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const sessionTokenPattern = /^[^\s]{32,2048}$/u;

function isStrictVersion(value: string): boolean {
  return (
    versionPattern.test(value) &&
    value.split(".").every((part) => Number.isSafeInteger(Number(part)))
  );
}

export function extensionSessionHeaders(sessionToken: string, clientVersion: string) {
  if (!sessionTokenPattern.test(sessionToken)) {
    throw new TypeError("Extension session token is invalid.");
  }
  if (!isStrictVersion(clientVersion)) {
    throw new TypeError("Extension client version is invalid.");
  }
  return {
    Authorization: `HuayiExtension ${sessionToken}`,
    "X-Huayi-Client-Version": clientVersion,
  } as const;
}
