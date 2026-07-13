import { APP_SERVER_DISABLED_FEATURES, isSafeMcpServerName } from "./codex-app-server-config.js";
import { buildAllowedEnvironment, type ProcessRunner } from "./codex-process.js";
import { capabilityMissingError } from "./error-mapper.js";

const MCP_DISCOVERY_MAXIMUM_OUTPUT_BYTES = 64 * 1024;
const MCP_DISCOVERY_MAXIMUM_SERVERS = 128;
const MCP_DISCOVERY_TIMEOUT_MS = 10_000;

interface McpListRecord {
  enabled: boolean;
  name: string;
}

export interface CodexMcpDiscoveryOptions {
  codexExecutable: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  processRunner: ProcessRunner;
  workingDirectory: string;
}

function parseMcpList(stdout: string): readonly string[] {
  const value: unknown = JSON.parse(stdout);
  if (!Array.isArray(value) || value.length > MCP_DISCOVERY_MAXIMUM_SERVERS) {
    throw new TypeError("Invalid Codex MCP list.");
  }

  const seen = new Set<string>();
  const enabled: string[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      typeof (candidate as { name?: unknown }).name !== "string" ||
      typeof (candidate as { enabled?: unknown }).enabled !== "boolean"
    ) {
      throw new TypeError("Invalid Codex MCP record.");
    }

    const record = candidate as McpListRecord;
    if (!isSafeMcpServerName(record.name) || seen.has(record.name)) {
      throw new TypeError("Invalid Codex MCP server name.");
    }
    seen.add(record.name);
    if (record.enabled) {
      enabled.push(record.name);
    }
  }
  return enabled;
}

export async function discoverEnabledMcpServerNames(
  options: CodexMcpDiscoveryOptions,
): Promise<readonly string[]> {
  try {
    const result = await options.processRunner.run({
      arguments: [
        "mcp",
        "list",
        "--json",
        ...APP_SERVER_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      ],
      cwd: options.workingDirectory,
      env: buildAllowedEnvironment(options.environment),
      executable: options.codexExecutable,
      input: "",
      maximumOutputBytes: MCP_DISCOVERY_MAXIMUM_OUTPUT_BYTES,
      timeoutMs: MCP_DISCOVERY_TIMEOUT_MS,
    });
    if (result.exitCode !== 0 || result.signal !== null) {
      throw new TypeError("Codex MCP discovery failed.");
    }
    return parseMcpList(result.stdout);
  } catch (error) {
    throw capabilityMissingError(error);
  }
}
