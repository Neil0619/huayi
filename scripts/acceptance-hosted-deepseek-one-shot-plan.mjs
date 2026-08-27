const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";

export const hostedDeepSeekOneShotConfirmation =
  "--confirm-hosted-cloud-web-deepseek-one-shot-kpadiulxkgckskcfydry";
export const hostedDeepSeekWebOrigin = "https://app.acceptance.seen-said.cn";
export const hostedDeepSeekWebPath = "/analysis";
export const hostedDeepSeekAnalysisStreamPath = "/v1/analyses:stream";

export function renderHostedDeepSeekOneShotPlan() {
  return `Hosted Cloud Web DeepSeek one-shot acceptance plan (zero filesystem / zero Git / zero network / zero Hosted write)
- Attest the fixed Cloud Web page ${hostedDeepSeekWebOrigin}${hostedDeepSeekWebPath}, then send exactly one normal product request to ${hostedDeepSeekAnalysisStreamPath}; Classic \`pnpm smoke:deepseek\` is forbidden.
- This module has no default real executor and does not infer an admin endpoint, authentication flow, credential source, durable store, or remote response shape. Separately reviewed adapters must use a hidden interactive channel for every credential; no token, key, or password may enter output, argv, or an inherited environment.
- The only caller seam is status(), execute(approval), and recover(). Status is a read-only authority query with an absolute five-second bound; direct lifecycle and adapter stages remain private.
- Approval contains only the candidate commit, exact confirmation, and reservation cap. The durable authority generates operation and idempotency identities while atomically consuming the approval; the same approval can never dispatch twice. The server request ID is bound only from analysis.started after dispatch.
- Before any login, require a clean and pushed candidate commit, the exact READY Hosted API/Web deployment pair with independently attested full source SHAs, a 30-second session-free pre-snapshot, a caller-approved peak reservation cap, and a valid atomically claimed operation. The preflight owns one absolute 10-second envelope; each fixed deployment management/runtime GET has an independent five-second bound. Invalid preflight or claim performs zero login and zero logout.
- Only after a valid claim, share one absolute 10-second session-establishment envelope across normal password login, password reauthentication with Cookie/CSRF rotation, and Operator readback.
- Before disabling the DeepSeek kill switch, durably arm a reclaimable cleanup lease. After arm, both validated leases must strictly cover the 90-second application, 10-second cleanup, and independent 10-second logout windows; the operation expiry must not exceed the server-authoritative armedAt plus 120 seconds.
- Before the one Cloud Web HTTP request, persist dispatch-attempted. After its analysis.started event, bind that server-generated request ID before settlement; recovery claims only one unique pending cleanup and never accepts an opaque operation ID.
- If the POST disconnects before analysis.started, perform one bounded fenced SQL reconciliation by the authority-owned idempotency key, owner, and fixed payload digest. Reconcile and bind exactly one match atomically, continue settlement, and never POST again; zero, multiple, incomplete, or mismatched results fail closed.
- The orchestrator owns one absolute 90-second deadline across kill-switch disable, dispatch, binding, and server settlement. Its deadline wins even if an adapter ignores abort. Budget, deadline, and signal are adapter control only; never Web request body or Provider parameters.
- Recovery owns a separate absolute 20-second reconciliation/settlement evidence envelope. Its timeout still proceeds to independent cleanup and logout; caller-selected receipt digests are forbidden because Postgres constructs, hashes, and freezes the receipt.
- Every post-login exit attempts restoration before exactly one normal logout under an independent absolute 10-second signal. Application abort cannot suppress logout; logout outcome is known and in-memory session capability is synchronously destroyed before durable cleanup completion and operation terminalization.
- Accept only fresh private server-authoritative evidence bound to the exact deployment pair and continuous zero-based UsageLedger calls. Public success is fixed and exposes no opaque IDs, price UUID, or token-usage details.
`;
}

export async function runHostedDeepSeekOneShotCli({
  arguments_ = process.argv.slice(2),
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "plan") {
    writeOutput(renderHostedDeepSeekOneShotPlan());
    return 0;
  }
  writeError(`${failureMessage}\n`);
  return 1;
}
