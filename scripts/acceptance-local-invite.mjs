import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environmentPath = resolve(repositoryRoot, ".env.acceptance.local");
const databaseContainer = "supabase_db_seen-and-said-local-acceptance";
const localOperatorId = "00000000-0000-4000-8000-000000000047";

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function runPsql(input) {
  return new Promise((resolveResult) => {
    const child = spawn(
      "docker",
      ["exec", "-i", databaseContainer, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
      {
        cwd: repositoryRoot,
        shell: false,
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      },
    );
    child.once("error", () => resolveResult(false));
    child.once("exit", (code, signal) => resolveResult(signal === null && code === 0));
    child.stdin.end(input);
  });
}

function secretPepper(contents) {
  const line = contents.split(/\r?\n/u).find((item) => item.startsWith("HUAYI_SECRET_PEPPER="));
  if (line === undefined) throw new Error("Local acceptance environment is invalid.");
  const value = line.slice("HUAYI_SECRET_PEPPER=".length);
  if (value.length < 32) throw new Error("Local acceptance environment is invalid.");
  return value;
}

export function renderInvitationSql(values) {
  return `
BEGIN;
INSERT INTO public.user_profiles (
  user_id, owner_user_id, email, status, timezone, daily_goal
) VALUES (
  ${sqlLiteral(values.operatorId)}, ${sqlLiteral(values.operatorId)},
  'local-acceptance-operator@seen-said.localhost', 'active', 'Asia/Shanghai', 1
)
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.admin_roles (user_id, role)
VALUES (${sqlLiteral(values.operatorId)}, 'operator')
ON CONFLICT (user_id) DO UPDATE SET role = 'operator';
SELECT public.admin_create_invitation(
  ${sqlLiteral(values.invitationId)}, ${sqlLiteral(values.tokenHash)},
  now() + interval '72 hours', ${sqlLiteral(values.operatorId)}, ${sqlLiteral(values.auditId)}
);
COMMIT;
`;
}

export function invitationUrl(token) {
  return `https://app.acceptance.localhost:8443/join#${token}`;
}

export async function createLocalInvitation() {
  const token = randomBytes(32).toString("base64url");
  const pepper = secretPepper(await readFile(environmentPath, "utf8"));
  const tokenHash = createHash("sha256")
    .update(pepper)
    .update("\0")
    .update(token)
    .digest("base64url");
  const succeeded = await runPsql(
    renderInvitationSql({
      auditId: randomUUID(),
      invitationId: randomUUID(),
      operatorId: localOperatorId,
      tokenHash,
    }),
  );
  if (!succeeded) throw new Error("Local acceptance invitation could not be created.");
  return invitationUrl(token);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createLocalInvitation()
    .then((url) => process.stdout.write(`${url}\n`))
    .catch(() => {
      process.stderr.write("Local acceptance invitation creation failed.\n");
      process.exitCode = 1;
    });
}
