import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const sessionProof = (secret, challenge, nonce) =>
  createHmac("sha256", secret).update(`proof:${challenge}:${nonce}`).digest("hex");
export const sessionToken = (secret, nonce) =>
  createHmac("sha256", secret).update(`token:${nonce}`).digest("hex");

async function readIdentity(path) {
  for (let attempt = 0; ; attempt++) {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      if (
        value.version !== 1 ||
        !Number.isInteger(value.port) ||
        value.port < 1024 ||
        value.port > 65535 ||
        typeof value.secret !== "string" ||
        !/^[a-f0-9]{64}$/u.test(value.secret)
      )
        throw new Error("打开器浏览器身份记录无效。");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      // An exclusive first-start write can be observed before its final bytes arrive.
      if (!(error instanceof SyntaxError) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function reuse(identity) {
  const origin = `http://127.0.0.1:${identity.port}`;
  const challenge = randomBytes(32).toString("hex");
  let response;
  try {
    response = await fetch(`${origin}/api/session?challenge=${challenge}`, {
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });
  } catch {
    return null;
  }
  if (response.status !== 200) throw new Error("打开器端口被其他程序占用。");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.byteLength;
    if (length > 512) throw new Error("打开器身份验证失败。");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("打开器身份验证失败。");
  }
  if (
    typeof data.nonce !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.nonce) ||
    typeof data.proof !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.proof) ||
    !timingSafeEqual(
      Buffer.from(data.proof),
      Buffer.from(sessionProof(identity.secret, challenge, data.nonce)),
    )
  )
    throw new Error("打开器身份验证失败。");
  const token = sessionToken(identity.secret, data.nonce);
  return { origin, token, url: `${origin}/#${token}`, reused: true, close: async () => undefined };
}

/** Persist only the local origin identity; each running server derives a fresh session token. */
export async function startPersistentOpener(identityPath, create) {
  const identity = await readIdentity(identityPath);
  if (identity) {
    const running = await reuse(identity);
    if (running) return running;
    return create({ port: identity.port, secret: identity.secret });
  }
  const secret = randomBytes(32).toString("hex");
  const opener = await create({ port: 0, secret });
  try {
    await mkdir(dirname(identityPath), { recursive: true });
    await writeFile(
      identityPath,
      JSON.stringify({ version: 1, port: Number(new URL(opener.origin).port), secret }),
      { flag: "wx", mode: 0o600 },
    );
    return opener;
  } catch (error) {
    await opener.close();
    if (error.code !== "EEXIST") throw error;
    // Another launch published the identity first. Verify it before opening its URL.
    return startPersistentOpener(identityPath, create);
  }
}
