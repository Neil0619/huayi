import assert from "node:assert/strict";
import test from "node:test";

import { invitationUrl, renderInvitationSql } from "./acceptance-local-invite.mjs";

test("local invitation SQL stores only the token hash", () => {
  const sql = renderInvitationSql({
    auditId: "00000000-0000-4000-8000-000000000003",
    invitationId: "00000000-0000-4000-8000-000000000002",
    operatorId: "00000000-0000-4000-8000-000000000001",
    tokenHash: "stored-token-hash",
  });

  assert.match(sql, /admin_create_invitation/u);
  assert.match(sql, /stored-token-hash/u);
  assert.doesNotMatch(sql, /plain-invitation-token/u);
  assert.match(sql, /local-acceptance-operator@seen-said\.localhost/u);
});

test("local invitation URL keeps the one-time token in the fragment", () => {
  assert.equal(
    invitationUrl("plain-invitation-token"),
    "https://app.acceptance.localhost:8443/join#plain-invitation-token",
  );
});
