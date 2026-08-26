import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";
const emailPattern =
  /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/iu;
const prompts = Object.freeze({
  email: "Hosted Operator email: ",
  password: "Hosted Operator password: ",
});

function fail() {
  throw new Error(failureMessage);
}

function isInteractiveTerminal(stream) {
  return typeof stream === "object" && stream !== null && stream.isTTY === true;
}

function hasControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function parseEmail(value) {
  if (typeof value !== "string" || hasControlCharacter(value)) fail();
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 320 || !emailPattern.test(normalized)) fail();
  return normalized;
}

function parsePassword(value) {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    value.length > 256 ||
    hasControlCharacter(value)
  ) {
    fail();
  }
  return value;
}

function freezeCredentials(email, password) {
  const credentials = {};
  Object.defineProperties(credentials, {
    email: { configurable: false, enumerable: false, value: email, writable: false },
    password: { configurable: false, enumerable: false, value: password, writable: false },
  });
  return Object.freeze(credentials);
}

export async function readHostedDeepSeekOperatorCredentials({
  input = process.stdin,
  output = process.stderr,
  readHiddenLine = readHiddenTerminalLine,
} = {}) {
  try {
    if (
      !isInteractiveTerminal(input) ||
      !isInteractiveTerminal(output) ||
      typeof readHiddenLine !== "function"
    ) {
      fail();
    }
    const email = parseEmail(await readHiddenLine(prompts.email));
    const password = parsePassword(await readHiddenLine(prompts.password));
    return freezeCredentials(email, password);
  } catch {
    fail();
  }
}
