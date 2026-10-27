import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { DEFAULT_GUILD_SETTINGS, type GuildSettings } from "../shared/settings.js";
import { GATHER_MS, MemberAnnouncements, REPEAT_AFTER_MS } from "./MemberAnnouncements.js";

const GUILD = "guild-1";
const ann = { id: "1", name: "Ann" };
const bob = { id: "2", name: "Bob" };

let said: string[];
let settings: GuildSettings;
let announcements: MemberAnnouncements;

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  said = [];
  settings = structuredClone(DEFAULT_GUILD_SETTINGS);
  settings.autoAnnouncements.memberJoin.enabled = true;
  settings.autoAnnouncements.memberLeave.enabled = true;
  announcements = new MemberAnnouncements(
    { announceAutomatically: async (_guildId, text) => void said.push(text) },
    { guild: () => settings },
  );
});

test("a join is said once the gathering time is over", () => {
  announcements.memberJoined(GUILD, ann);
  mock.timers.tick(GATHER_MS - 1);
  assert.deepEqual(said, []);
  mock.timers.tick(1);
  assert.deepEqual(said, ["Welcome, Ann!"]);
});

test("people joining close together are named in one announcement", () => {
  announcements.memberJoined(GUILD, ann);
  mock.timers.tick(1_000);
  announcements.memberJoined(GUILD, bob);
  mock.timers.tick(GATHER_MS);
  assert.deepEqual(said, ["Welcome, Ann and Bob!"]);
});

test("joins and leaves are announced separately", () => {
  announcements.memberJoined(GUILD, ann);
  announcements.memberLeft(GUILD, bob);
  mock.timers.tick(GATHER_MS);
  assert.deepEqual(said.sort(), ["Bye, Bob!", "Welcome, Ann!"]);
});

test("someone hopping back in soon isn't greeted again", () => {
  announcements.memberJoined(GUILD, ann);
  mock.timers.tick(GATHER_MS);
  announcements.memberJoined(GUILD, ann);
  mock.timers.tick(GATHER_MS);
  assert.deepEqual(said, ["Welcome, Ann!"]);

  mock.timers.tick(REPEAT_AFTER_MS);
  announcements.memberJoined(GUILD, ann);
  mock.timers.tick(GATHER_MS);
  assert.deepEqual(said, ["Welcome, Ann!", "Welcome, Ann!"]);
});

test("nothing is said when the announcement is off", () => {
  settings.autoAnnouncements.memberJoin.enabled = false;
  announcements.memberJoined(GUILD, ann);
  mock.timers.tick(GATHER_MS);
  assert.deepEqual(said, []);
});

test("switching it off while names are gathered means nothing is said", () => {
  announcements.memberJoined(GUILD, ann);
  settings.autoAnnouncements.memberJoin.enabled = false;
  mock.timers.tick(GATHER_MS);
  assert.deepEqual(said, []);
});

test("the server's own message is used", () => {
  settings.autoAnnouncements.memberJoin.message = "{name} is here, everyone say hi";
  announcements.memberJoined(GUILD, ann);
  mock.timers.tick(GATHER_MS);
  assert.deepEqual(said, ["Ann is here, everyone say hi"]);
});
