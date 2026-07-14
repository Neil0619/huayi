import { OpenAIApiKeyReader } from "../credentials/openai-keychain.js";
import { readNativeHostConfiguration } from "../main.js";
import type { OpenAIFetch } from "../provider/openai-responses-client.js";
import { CodexAppServerClient } from "../runtime/codex-app-server.js";
import { discoverEnabledMcpServerNames } from "../runtime/codex-mcp-discovery.js";
import { NodeProcessRunner } from "../runtime/codex-process.js";
import {
  comparisonTableRows,
  runProviderComparison,
  serializeComparisonReport,
} from "./compare-providers.js";
import { createComparisonProviders } from "./comparison-provider-runtime.js";

interface ComparisonOutput {
  error(line: string): void;
  log(line: string): void;
  table(rows: readonly Record<string, unknown>[]): void;
}

const defaultOpenAIFetch: OpenAIFetch = async (url, init) => fetch(url, init);

export async function runConfiguredProviderComparison(
  environment: NodeJS.ProcessEnv = process.env,
  output: ComparisonOutput = console,
): Promise<number> {
  const processRunner = new NodeProcessRunner();
  const nativeHostModuleUrl = new URL("../main.js", import.meta.url).href;
  const configuration = readNativeHostConfiguration(environment, nativeHostModuleUrl);
  const appServer = new CodexAppServerClient({
    codexExecutable: configuration.codexExecutable,
    environment: configuration.environment,
    mcpServerDiscovery: () =>
      discoverEnabledMcpServerNames({
        codexExecutable: configuration.codexExecutable,
        environment: configuration.environment,
        processRunner,
        workingDirectory: configuration.workingDirectory,
      }),
    workingDirectory: configuration.workingDirectory,
  });
  const apiKeyReader = new OpenAIApiKeyReader({
    environment: configuration.environment,
    processRunner,
    workingDirectory: configuration.workingDirectory,
  });
  try {
    const providers = createComparisonProviders({
      apiKeyReader,
      appServer,
      openAIFetch: defaultOpenAIFetch,
      schemaDirectory: configuration.schemaDirectory,
    });
    await providers["codex-gpt-5.4-mini-low"]({
      rawDelta: () => undefined,
      upstreamSent: () => undefined,
    }).warmup(new AbortController().signal);
    const report = await runProviderComparison({ providers });
    output.log(serializeComparisonReport(report));
    output.table(comparisonTableRows(report));
    return report.qualityPassed ? 0 : 1;
  } finally {
    appServer.dispose();
  }
}
