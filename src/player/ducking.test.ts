import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DUCK_FACTOR, duckedVolume } from "./ducking.js";

describe("duckedVolume", () => {
  it("turns the music down to 30% of where it was", () => {
    assert.equal(DUCK_FACTOR, 0.3);
    assert.equal(duckedVolume(100), 30);
    assert.equal(duckedVolume(150), 45);
  });

  it("gives whole numbers, as Lavalink wants", () => {
    assert.equal(duckedVolume(55), 17); // 55 × 0.3 = 16.5, rounded to 17
    assert.ok(Number.isInteger(duckedVolume(33)));
  });

  it("leaves silence silent", () => {
    assert.equal(duckedVolume(0), 0);
  });
});
