// security's hidden password prompt truncates long input. Interactive command mode
// accepts hex data over stdin without a PTY, secret argv, environment, or files.
export function renderMacosKeychainInput(arguments_, value) {
  const quote = (argument) => `"${argument.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return `${arguments_.slice(0, -1).map(quote).join(" ")} -X ${Buffer.from(value, "utf8").toString("hex")}\n`;
}
