import assert from "node:assert/strict";
import { test } from "node:test";
import { UserError } from "../player/errors.js";
import { MAX_ANNOUNCEMENT_LENGTH } from "../shared/announcements.js";
import { cleanAnnouncementText } from "./speech.js";

test("line breaks and repeated spaces become single spaces", () => {
  assert.equal(cleanAnnouncementText("  Pizza   is\nhere!\r\n\tCome  down. "), "Pizza is here! Come down.");
});

test("empty text is refused", () => {
  assert.throws(() => cleanAnnouncementText(" \n "), UserError);
});

test("text up to the limit is allowed; spaces that get removed don't count", () => {
  const atLimit = "a".repeat(MAX_ANNOUNCEMENT_LENGTH);
  assert.equal(cleanAnnouncementText(`  ${atLimit}  `), atLimit);
});

test("text over the limit is refused", () => {
  assert.throws(() => cleanAnnouncementText("a".repeat(MAX_ANNOUNCEMENT_LENGTH + 1)), UserError);
});
