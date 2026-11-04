import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUDIO_FILTERS, FILTER_DESCRIPTIONS, playbackRate, TIMESCALES } from "../shared/filters.js";

describe("daycore", () => {
  it("is one of the effects, with a description for /filter and the website", () => {
    assert.ok(AUDIO_FILTERS.includes("daycore"));
    assert.match(FILTER_DESCRIPTIONS.daycore, /slower/i);
  });

  it("slows tempo and pitch down together, like a record played too slow (the opposite of nightcore)", () => {
    const { speed, pitch } = TIMESCALES.daycore;
    assert.equal(speed, pitch);
    assert.ok(speed < 1);
  });

  it("moves the website's progress bar at the slower speed", () => {
    assert.equal(playbackRate("daycore"), 0.8);
  });
});

describe("playbackRate", () => {
  it("is 1 for effects that don't change speed", () => {
    assert.equal(playbackRate("off"), 1);
    assert.equal(playbackRate("bassboost"), 1);
  });

  it("is faster for nightcore and slower for vaporwave", () => {
    assert.ok(playbackRate("nightcore") > 1);
    assert.ok(playbackRate("vaporwave") < 1);
  });
});
