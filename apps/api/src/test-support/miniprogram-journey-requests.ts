import {
  miniProgramAccountSchema,
  miniProgramLoginResponseSchema,
  miniProgramRoutes,
  miniProgramSessionSchema,
  upsertWordResponseSchema,
  wordCatalogEntrySchema,
  wordCatalogListSchema,
} from "@huayi/cloud-contracts";
import { expect } from "vitest";
import {
  journeyOrigin,
  journeyPassword,
  type MiniProgramJourneyFixture,
} from "./miniprogram-journey-fixture.js";

export type JourneyHeaders = Record<string, string>;
export const miniHeaders = (token: string): JourneyHeaders => ({
  authorization: `HuayiMiniProgram ${token}`,
});
export async function jsonRequest(
  f: MiniProgramJourneyFixture,
  path: string,
  headers: JourneyHeaders,
  body: unknown,
  status = 200,
) {
  const response = await f.app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  await expectStatus(response, path, status);
  return response;
}
export async function beginMini(f: MiniProgramJourneyFixture, code: string) {
  return miniProgramLoginResponseSchema.parse(
    await (await jsonRequest(f, miniProgramRoutes.login, {}, { code })).json(),
  );
}
export async function openMini(f: MiniProgramJourneyFixture, code: string) {
  const start = await beginMini(f, code);
  if (start.state !== "onboarding") throw new Error("Expected onboarding choice.");
  const response = await jsonRequest(
    f,
    miniProgramRoutes.onboard,
    {},
    { ticket: start.ticket, mode: "independent" },
  );
  const session = miniProgramSessionSchema.parse(await response.json());
  const headers = miniHeaders(session.token);
  const account = miniProgramAccountSchema.parse(
    await (await f.app.request(miniProgramRoutes.account, { headers })).json(),
  );
  return { ...session, headers, account, code };
}
async function webHeaders(response: Response): Promise<JourneyHeaders> {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  const body: unknown = await response.json();
  if (
    !cookie ||
    typeof body !== "object" ||
    body === null ||
    !("csrfToken" in body) ||
    typeof body.csrfToken !== "string"
  )
    throw new Error("Web login did not return session and CSRF proof.");
  return { cookie, origin: journeyOrigin, "x-csrf-token": body.csrfToken };
}
export async function loginWeb(f: MiniProgramJourneyFixture, email: string) {
  return webHeaders(
    await jsonRequest(f, "/v1/auth/password/login", {}, { email, password: journeyPassword }),
  );
}
export async function reauthenticateWeb(f: MiniProgramJourneyFixture, headers: JourneyHeaders) {
  return webHeaders(
    await jsonRequest(f, "/v1/auth/reauthenticate/password", headers, {
      password: journeyPassword,
    }),
  );
}
export async function addWord(
  f: MiniProgramJourneyFixture,
  headers: JourneyHeaders,
  headword: string,
) {
  const response = await jsonRequest(f, "/v1/words", headers, {
    headword,
    context: { sourceText: `I remember ${headword}.` },
  });
  return upsertWordResponseSchema.parse(await response.json());
}
export async function listWords(f: MiniProgramJourneyFixture, headers: JourneyHeaders, query = "") {
  const response = await f.app.request(`/v2/words${query}`, { headers });
  expect(response.status).toBe(200);
  return wordCatalogListSchema.parse(await response.json());
}
export async function archiveWord(
  f: MiniProgramJourneyFixture,
  headers: JourneyHeaders,
  id: string,
  revision: number,
  archived: boolean,
) {
  const response = await jsonRequest(
    f,
    `/v2/words/${id}/archive`,
    { ...headers, "if-match": `"${revision}"` },
    { archived, expectedRevision: revision },
  );
  return wordCatalogEntrySchema.parse(await response.json());
}

export async function readStatus(
  f: MiniProgramJourneyFixture,
  path: string,
  headers: JourneyHeaders,
  status: number,
) {
  const response = await f.app.request(path, { headers });
  await expectStatus(response, path, status);
  return response;
}

async function expectStatus(response: Response, path: string, status: number) {
  expect(response.status, `${path}: ${await response.clone().text()}`).toBe(status);
  const codes: Record<number, string> = {
    400: "invalid_request",
    401: "authentication_required",
    403: "forbidden",
    404: "not_found",
    409: "revision_conflict",
  };
  if (codes[status]) {
    // A missing Hono route is also 404; demand the actual owner-boundary fault.
    expect(await response.clone().json()).toMatchObject({ error: { code: codes[status] } });
  }
}
