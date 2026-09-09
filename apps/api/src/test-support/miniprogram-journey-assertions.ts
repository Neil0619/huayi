import { createHash } from "node:crypto";
import {
  accountDataExportJobResourceSchema,
  accountDataExportRecordSchema,
} from "@huayi/cloud-contracts";
import { expect } from "vitest";
import type { MiniProgramJourneyFixture } from "./miniprogram-journey-fixture.js";
import { jsonRequest, readStatus, type JourneyHeaders } from "./miniprogram-journey-requests.js";

export async function exportWords(
  f: MiniProgramJourneyFixture,
  headers: JourneyHeaders,
  ids: string[],
) {
  const created = accountDataExportJobResourceSchema.parse(
    await (await jsonRequest(f, "/v1/account-data-exports", headers, {}, 201)).json(),
  );
  expect(await f.worker.runOne()).toEqual({ deletion: "idle", export: "processed" });
  const current = await readStatus(f, "/v1/account-data-exports/current", headers, 200);
  const body: unknown = await current.json();
  expect(body).toMatchObject({ job: { id: created.id, state: "ready" } });
  const [key, bytes] = [...f.objects.entries()][0] ?? [];
  if (!key || !bytes) throw new Error("Worker did not upload the export.");
  const records = new TextDecoder()
    .decode(bytes)
    .trim()
    .split("\n")
    .map((line) => accountDataExportRecordSchema.parse(JSON.parse(line)));
  expect(records[0]).toMatchObject({ recordType: "manifest", schemaVersion: 1 });
  expect(records.some((record) => record.recordType === "account-preferences")).toBe(true);
  const words = records.filter((record) => record.recordType === "word");
  expect(words.map((record) => record.word.id).sort()).toEqual([...ids].sort());
  for (const record of words) expect(record.word.contexts).toHaveLength(1);
  expect(
    (
      await f.db.query(
        "SELECT record_count,byte_length,sha256 FROM account_data_export_jobs WHERE id=$1",
        [created.id],
      )
    ).rows,
  ).toEqual([
    {
      record_count: records.length,
      byte_length: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  ]);
  return { id: created.id, key, bytes, words };
}
export async function deleteAccount(
  f: MiniProgramJourneyFixture,
  owner: string,
  headers: JourneyHeaders,
  sessions: JourneyHeaders[],
  linked: boolean,
) {
  const key = crypto.randomUUID();
  const request = { confirmation: "delete-account" };
  const response = await jsonRequest(
    f,
    "/v1/account-deletion",
    { ...headers, "idempotency-key": key },
    request,
    202,
  );
  expect(await response.json()).toMatchObject({ accepted: true });
  for (const session of sessions) await readStatus(f, "/v2/words", session, 401);
  expect(
    (await f.db.query("SELECT status FROM user_profiles WHERE user_id=$1", [owner])).rows,
  ).toEqual([{ status: "deleting" }]);
  expect(
    (
      await f.db.query(
        "SELECT delete_auth_user FROM account_deletion_jobs WHERE subject_user_id=$1",
        [owner],
      )
    ).rows,
  ).toEqual([{ delete_auth_user: linked }]);
  await jsonRequest(
    f,
    "/v1/account-deletion",
    { ...headers, "idempotency-key": key },
    request,
    202,
  );
  expect(await f.worker.runOne()).toEqual({ deletion: "processed", export: "idle" });
  for (const table of [
    "user_profiles",
    "wechat_identities",
    "miniprogram_sessions",
    "web_sessions",
    "word_entries",
  ]) {
    const column = table === "user_profiles" ? "user_id" : "owner_user_id";
    expect(
      (
        await f.db.query(`SELECT count(*)::integer AS count FROM ${table} WHERE ${column}=$1`, [
          owner,
        ])
      ).rows,
    ).toEqual([{ count: 0 }]);
  }
  expect(f.objects.size).toBe(0);
  if (linked) expect(f.authority.deleteAuthUser).toHaveBeenCalledExactlyOnceWith(owner);
  else expect(f.authority.deleteAuthUser).not.toHaveBeenCalled();
}
