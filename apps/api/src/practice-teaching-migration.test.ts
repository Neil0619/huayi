import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const owner = "00000000-0000-0000-0000-000000000001";
const session = "10000000-0000-0000-0000-000000000001";
const second = "10000000-0000-0000-0000-000000000002";
const first = "70000000-0000-0000-0000-000000000005";

it("mirrors the migration and preserves real old answers while enforcing bounded parent identity", async () => {
  const sql = await readFile(
    new URL("../migrations/0034-practice-teaching-state.sql", import.meta.url),
    "utf8",
  );
  expect(
    await readFile(
      new URL(
        "../../../supabase/migrations/20260913030000_practice_teaching_state.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toBe(sql);
  const db = new PGlite();
  try {
    for (const name of ["0001-cloud-v1-foundation.sql", "0025-practice-workspace.sql"])
      await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    await db.query(
      "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'offline@example.test','active','UTC',5)",
      [owner],
    );
    await db.query(
      "INSERT INTO practice_sessions(id,owner_user_id,type,status) VALUES($1,$3,'sentence-creation','completed'),($2,$3,'sentence-creation','completed')",
      [session, second, owner],
    );
    await db.query(
      "INSERT INTO practice_attempts(id,session_id,owner_user_id,answer,feedback,submitted_at) VALUES($1,$2,$3,'Original answer.','Original feedback.',now())",
      [first, session, owner],
    );
    await db.exec(sql);
    expect(
      (
        await db.query(
          "SELECT answer,feedback,ordinal,parent_attempt_id,teaching_contract,hint_viewed_at,feedback_completed_at FROM practice_attempts",
        )
      ).rows,
    ).toEqual([
      {
        answer: "Original answer.",
        feedback: "Original feedback.",
        ordinal: 0,
        parent_attempt_id: null,
        teaching_contract: null,
        hint_viewed_at: null,
        feedback_completed_at: null,
      },
    ]);
    let parent = first;
    for (let ordinal = 1; ordinal < 5; ordinal++) {
      const id = `70000000-0000-0000-0000-00000000000${5 - ordinal}`;
      await db.query(
        "INSERT INTO practice_attempts(id,session_id,owner_user_id,answer,submitted_at,ordinal,parent_attempt_id) VALUES($1,$2,$3,'Rewrite.',now(),$4,$5)",
        [id, session, owner, ordinal, parent],
      );
      parent = id;
    }
    for (const [target, ordinal, parentId] of [
      [session, 5, parent],
      [second, 1, first],
      [session, 0, first],
    ] as const)
      await expect(
        db.query(
          "INSERT INTO practice_attempts(id,session_id,owner_user_id,answer,submitted_at,ordinal,parent_attempt_id) VALUES($1,$2,$3,'Invalid.',now(),$4,$5)",
          [crypto.randomUUID(), target, owner, ordinal, parentId],
        ),
      ).rejects.toThrow();
    expect((await db.query("SELECT id FROM practice_attempts")).rows).toHaveLength(5);
    await db.query("DELETE FROM practice_sessions WHERE id=$1", [session]);
    expect((await db.query("SELECT id FROM practice_attempts")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});
