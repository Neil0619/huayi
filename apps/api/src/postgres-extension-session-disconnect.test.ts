import { describe, expect, it, vi } from "vitest";

import type { AnalysisDatabase } from "./analysis-database.js";
import { createPostgresExtensionSessionDisconnect } from "./postgres-extension-session-disconnect.js";
import { hashSecret } from "./security.js";

describe("Postgres Extension session disconnect", () => {
  it("hashes the proof and executes one trusted self-revocation without exposing a result", async () => {
    const rows = vi.fn().mockResolvedValue([{ revoke_current_extension_session: true }]);
    const database: AnalysisDatabase = {
      async transaction() {
        throw new Error("not used");
      },
      async trusted(operation) {
        return operation({ rows });
      },
    };
    const pepper = "test-pepper-at-least-32-characters";
    const token = "session-token-at-least-32-characters";
    const revoke = createPostgresExtensionSessionDisconnect({ database, pepper });

    await expect(revoke(token)).resolves.toBeUndefined();

    expect(rows).toHaveBeenCalledOnce();
    expect(rows).toHaveBeenCalledWith("SELECT revoke_current_extension_session($1)", [
      hashSecret(token, pepper),
    ]);
    expect(rows.mock.calls[0]?.[1]).not.toContain(token);
  });
});
