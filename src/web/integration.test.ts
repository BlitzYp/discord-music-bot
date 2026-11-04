import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { integrationKeyMatches, integrationUserOf } from "./integration.js";

const KEY = "a".repeat(40);

describe("integrationKeyMatches", () => {
  it("accepts the right key", () => {
    assert.equal(integrationKeyMatches(`Bearer ${KEY}`, KEY), true);
  });

  it("refuses a wrong key, a missing header and a header without 'Bearer'", () => {
    assert.equal(integrationKeyMatches(`Bearer ${"b".repeat(40)}`, KEY), false);
    assert.equal(integrationKeyMatches(undefined, KEY), false);
    assert.equal(integrationKeyMatches(KEY, KEY), false);
  });

  it("refuses everything when no key is set up (INTEGRATION_KEY empty)", () => {
    assert.equal(integrationKeyMatches("Bearer ", undefined), false);
    assert.equal(integrationKeyMatches(`Bearer ${KEY}`, undefined), false);
  });
});

describe("integrationUserOf", () => {
  const headers = (extra: Record<string, string>) => ({ authorization: `Bearer ${KEY}`, ...extra });

  it("acts as the user named in the headers, with their name decoded", () => {
    const user = integrationUserOf(
      headers({ "x-acting-user-id": "123456789012345678", "x-acting-user-name": encodeURIComponent("Ålice 🎵") }),
      KEY,
    );
    assert.deepEqual(user, { id: "123456789012345678", name: "Ålice 🎵", avatarUrl: "" });
  });

  it("uses the id as the name when no name is sent", () => {
    assert.equal(integrationUserOf(headers({ "x-acting-user-id": "123456789012345678" }), KEY)?.name, "123456789012345678");
  });

  it("is nobody without an acting user, or with an id that isn't a Discord id", () => {
    assert.equal(integrationUserOf(headers({}), KEY), null);
    assert.equal(integrationUserOf(headers({ "x-acting-user-id": "../admin" }), KEY), null);
  });

  it("is nobody with the wrong key, even with an acting user", () => {
    const user = integrationUserOf({ authorization: "Bearer nope", "x-acting-user-id": "123456789012345678" }, KEY);
    assert.equal(user, null);
  });
});
