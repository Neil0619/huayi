import { pathToFileURL } from "node:url";

import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { createHostedReleaseCi } from "./acceptance-hosted-release-ci.mjs";
import { hostedReleaseConfirmation } from "./acceptance-hosted-release-contract.mjs";
import {
  inspectHostedReleaseGit,
  pushHostedReleaseCandidate,
  runHostedReleaseLocalQuality,
} from "./acceptance-hosted-release-git.mjs";
import { runHostedReleaseOrchestrator } from "./acceptance-hosted-release-orchestrator.mjs";
import { createHostedReleaseStateStore } from "./acceptance-hosted-release-state.mjs";
import { createHostedReleaseVercel } from "./acceptance-hosted-release-vercel.mjs";

const failureMessage = "Hosted acceptance release failed closed.";

function fail() {
  throw new Error(failureMessage);
}

export function renderHostedReleasePlan() {
  return [
    "语见 Hosted acceptance release plan (zero I/O)",
    "1. Bind one clean, disarmed commit as the exact candidate SHA.",
    "2. Run the complete local macOS quality gate, then push only that candidate.",
    "3. Dispatch one release-ID-bound Cross-platform quality run for macOS and Windows.",
    "4. Enable the fixed acceptance Store capability without reading or replacing other variables.",
    "5. Deploy the exact candidate to API then Web; never deploy both concurrently.",
    "6. Attest both production deployment identities and the fixed Extension CORS origin.",
    "7. Persist every boundary under artifacts/hosted-release/<release-id>/state.json.",
    "Interrupted mutation boundaries require recover; ordinary advance never guesses.",
    "This release flow does not run migrations, Cron, DeepSeek, or Chrome journeys.",
    "Those remain independent approval and business-acceptance gates after deployment.",
    "",
  ].join("\n");
}

function normalizeArguments(arguments_) {
  return arguments_.length === 3 && arguments_[1] === "--"
    ? [arguments_[0], arguments_[2]]
    : arguments_;
}

export async function createHostedReleaseProduction({
  environment = process.env,
  fetch_ = globalThis.fetch,
  readCredential = readHostedCredential,
  repositoryRoot = process.cwd(),
} = {}) {
  rejectLegacyHostedCredentialEnvironment(environment);
  const candidate = await inspectHostedReleaseGit({ repositoryRoot });
  const candidateSha = candidate.candidateSha;
  const stateStore = createHostedReleaseStateStore({ candidateSha, repositoryRoot });
  const ci = createHostedReleaseCi({ environment, repositoryRoot });
  let vercelPromise;
  const loadVercel = async () => {
    vercelPromise ??= readCredential("vercel-token", { environment }).then((token) =>
      createHostedReleaseVercel({ fetch_, token }),
    );
    return vercelPromise;
  };
  const vercel = Object.freeze({
    async attest(options) {
      return (await loadVercel()).attest(options);
    },
    async configure() {
      return (await loadVercel()).configure();
    },
    async create(options) {
      return (await loadVercel()).create(options);
    },
    async find(options) {
      return (await loadVercel()).find(options);
    },
    async inspect() {
      return (await loadVercel()).inspect();
    },
    async wait(options) {
      return (await loadVercel()).wait(options);
    },
  });
  const git = Object.freeze({
    inspect: () => inspectHostedReleaseGit({ repositoryRoot }),
    localQuality: () => runHostedReleaseLocalQuality({ environment, repositoryRoot }),
    push: ({ candidateSha: exactCandidate }) =>
      pushHostedReleaseCandidate({
        candidateSha: exactCandidate,
        environment,
        repositoryRoot,
      }),
  });
  return Object.freeze({
    candidateSha,
    async run(mode) {
      return runHostedReleaseOrchestrator({
        candidateSha,
        ci,
        git,
        mode,
        stateStore,
        vercel,
      });
    },
    async status() {
      return stateStore.read();
    },
  });
}

export async function runHostedReleaseCli({
  arguments_ = process.argv.slice(2),
  createProduction = createHostedReleaseProduction,
  environment = process.env,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    arguments_ = normalizeArguments(arguments_);
    if (arguments_.length === 1 && arguments_[0] === "plan") {
      writeOutput(renderHostedReleasePlan());
      return 0;
    }
    if (arguments_.length === 1 && arguments_[0] === "status") {
      const production = await createProduction({ environment });
      const state = await production.status();
      writeOutput(
        state === undefined
          ? `Hosted acceptance release status: not-started (${production.candidateSha}).\n`
          : `Hosted acceptance release status: ${state.phase} (${state.candidateSha}).\n`,
      );
      return 0;
    }
    if (
      arguments_.length !== 2 ||
      !["advance", "recover"].includes(arguments_[0]) ||
      arguments_[1] !== hostedReleaseConfirmation
    ) {
      fail();
    }
    const production = await createProduction({ environment });
    const state = await production.run(arguments_[0]);
    writeOutput(
      `Hosted acceptance release ${arguments_[0]} stopped at ${state?.phase ?? "complete"}.\n`,
    );
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedReleaseCli();
}
