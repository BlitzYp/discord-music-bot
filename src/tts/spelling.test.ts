import assert from "node:assert/strict";
import { test } from "node:test";
import { spellForSpeech } from "./spelling.js";

test("Japanese is spelled in romaji", async () => {
  assert.equal(await spellForSpeech("夜に駆ける"), "yoru ni kakeru");
});

test("Japanese inside an English sentence keeps the rest as it is", async () => {
  assert.equal(
    await spellForSpeech("Now playing YOASOBI - 夜に駆ける, requested by Ann."),
    "Now playing YOASOBI - yoru ni kakeru, requested by Ann.",
  );
});

test("kanji in text with kana are read as Japanese", async () => {
  assert.equal(await spellForSpeech("残酷な天使のテーゼ"), "zankoku na tenshi no teze");
});

test("Chinese characters without kana are read as Chinese", async () => {
  assert.equal(await spellForSpeech("周杰伦 - 稻香"), "zhou jie lun - dao xiang");
});

test("kanji next to kana in the same phrase are read as Japanese", async () => {
  assert.equal(await spellForSpeech("初音ミク - 千本桜"), "hatsune miku - sembon sakura");
});

test("a Japanese title doesn't make a Chinese one in another phrase Japanese", async () => {
  assert.equal(
    await spellForSpeech("YOASOBI - 夜に駆ける, then 周杰伦 - 稻香."),
    "YOASOBI - yoru ni kakeru, then zhou jie lun - dao xiang.",
  );
});

test("other alphabets are spelled in Latin letters", async () => {
  assert.equal(await spellForSpeech("Привет, Ελλάδα"), "Privet, Ellada");
});

test("Latin letters with accents, Korean, digits and emoji stay as they are", async () => {
  const text = "Mārcis Café 하늘 2024 🔥";
  assert.equal(await spellForSpeech(text), text);
});
