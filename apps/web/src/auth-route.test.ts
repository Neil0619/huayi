import { describe, expect, it } from "vitest";

import { parseAuthRoute } from "./auth-route.js";

describe("Web authentication routes", () => {
  it("reads an invitation only from the fragment so it is never sent in the HTTP path", () => {
    const token = "i".repeat(32);

    expect(parseAuthRoute("/join", `#${token}`)).toEqual({ invitationToken: token, mode: "join" });
    expect(parseAuthRoute(`/join/${token}`, "")).toBeUndefined();
    expect(parseAuthRoute("/join", `#${token}?leak=true`)).toBeUndefined();
  });

  it("recognizes the password login route without an invitation", () => {
    expect(parseAuthRoute("/login", "")).toEqual({ mode: "login" });
    expect(parseAuthRoute("/app", "")).toBeUndefined();
  });
});
