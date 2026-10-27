import assert from "node:assert/strict";
import { test } from "node:test";
import { fillMessage, joinNames, shortenForSpeech } from "./messages.js";

test("each {word} is filled in, as often as it appears", () => {
  assert.equal(
    fillMessage("Now playing {song}, requested by {user}. Thanks {user}!", { song: "One More Time", user: "Ann" }),
    "Now playing One More Time, requested by Ann. Thanks Ann!",
  );
});

test("a {word} without a value is left as written", () => {
  assert.equal(fillMessage("Hi {nmae}", { name: "Ann" }), "Hi {nmae}");
});

test("values aren't read as more {words}", () => {
  assert.equal(fillMessage("{song} by {artist}", { song: "{artist}", artist: "Daft Punk" }), "{artist} by Daft Punk");
});

test("names are joined the way they're said", () => {
  assert.equal(joinNames([]), "");
  assert.equal(joinNames(["Ann"]), "Ann");
  assert.equal(joinNames(["Ann", "Bob"]), "Ann and Bob");
  assert.equal(joinNames(["Ann", "Bob", "Cy"]), "Ann, Bob and Cy");
});

test("short text stays as it is, tidied", () => {
  assert.equal(shortenForSpeech("  Now  playing\nthis "), "Now playing this");
});

test("long text is cut at the last space that fits", () => {
  assert.equal(shortenForSpeech("Now playing a very long title", 20), "Now playing a very");
});

test("one long word is cut where the limit is", () => {
  assert.equal(shortenForSpeech("Supercalifragilistic", 10), "Supercalif");
});
