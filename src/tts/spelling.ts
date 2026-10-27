import anyAscii from "any-ascii";
import kuroshiroModule from "kuroshiro";
import KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";
import { pinyin } from "pinyin-pro";

/**
 * Piper's voices (English, German, Latvian) can only read Latin letters (accents are fine) and Korean. For anything
 * else they say the alphabet's name: 夜に駆ける comes out as "Japanese letter, Japanese letter…". So before speaking, other
 * writing is spelled in Latin letters, the way it's pronounced:
 * - Japanese → romaji with kuroshiro (夜に駆ける → "yoru ni kakeru"). Its dictionary tells which reading a kanji has.
 * - Chinese → pinyin without tone marks (北京 → "bei jing").
 * - Other alphabets (Cyrillic, Greek, Arabic…) → any-ascii (Привет → "Privet").
 *
 * Chinese characters are also used in Japanese, so each phrase (the text between commas and full stops) is looked at
 * on its own: a phrase with any Japanese kana in it is read as Japanese, all of it; otherwise its Chinese characters
 * are read as Chinese. "初音ミク - 千本桜" is Japanese throughout, but a title written only in kanji (千本桜 alone)
 * is read as Chinese. Deciding per phrase keeps a Japanese title from turning a Chinese one elsewhere in the same
 * announcement into Japanese.
 */

/** Where one phrase ends: commas, full stops and the like, also the Chinese and Japanese ones. */
const PHRASE_END = /([,.!?;:、。，！？；：]+)/;

/** Japanese writing: hiragana, katakana (also half-width), the long-vowel mark ー, and kanji with 々 and 〆. */
const JAPANESE_RUN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々〆]+/gu;
/** Kana only: tells Japanese text apart from Chinese. */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CHINESE_RUN = /\p{Script=Han}+/gu;
/**
 * Letters the voices can't read: anything that isn't Latin, Korean (Hangul, which Piper reads itself), or shared by
 * every language (digits, punctuation, spaces, emoji).
 */
const OTHER_ALPHABET_RUN = /[^\p{Script=Latin}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]+/gu;

/** The Japanese converter. Loading its dictionary takes about a third of a second, so it's done once, when first needed. */
let japanese: Promise<InstanceType<typeof kuroshiroModule.default>> | null = null;

/** `text` with everything Piper's voices can't read spelled in Latin letters. */
export async function spellForSpeech(text: string): Promise<string> {
  // split() with a capturing group keeps the punctuation between the phrases, so it's put back as it was.
  const pieces = text.split(PHRASE_END);
  let spelled = "";
  for (const piece of pieces) spelled += await spellChineseCharacters(piece);
  spelled = spelled.replace(OTHER_ALPHABET_RUN, (run) => ` ${anyAscii(run)} `);
  // The spaces added around converted parts keep them apart from their neighbours ("YOASOBI夜" → "YOASOBI yoru");
  // here they're tidied up again.
  return spelled.replace(/\s+/g, " ").replace(/ ([,.!?;:)])/g, "$1").trim();
}

/** One phrase with its Japanese spelled in romaji, or (with no kana in it) its Chinese characters in pinyin. */
async function spellChineseCharacters(phrase: string): Promise<string> {
  if (KANA.test(phrase)) return replaceRunsAsync(phrase, JAPANESE_RUN, toRomaji);
  return phrase.replace(CHINESE_RUN, (run) => ` ${pinyin(run, { toneType: "none" })} `);
}

async function toRomaji(run: string): Promise<string> {
  japanese ??= loadJapanese().catch((error: unknown) => {
    japanese = null; // try loading again next time
    throw error;
  });
  const converter = await japanese;
  // "passport" spells long vowels as plain letters (テーゼ → "teze"); the other systems add marks like ē.
  return converter.convert(run, { to: "romaji", mode: "spaced", romajiSystem: "passport" });
}

async function loadJapanese() {
  const converter = new kuroshiroModule.default();
  await converter.init(new KuromojiAnalyzer());
  return converter;
}

/** Like `text.replace(pattern, replacer)`, for a replacer that has to wait for something. */
async function replaceRunsAsync(text: string, pattern: RegExp, replacer: (run: string) => Promise<string>): Promise<string> {
  let result = "";
  let lastEnd = 0;
  for (const match of text.matchAll(pattern)) {
    result += text.slice(lastEnd, match.index) + ` ${await replacer(match[0])} `;
    lastEnd = match.index + match[0].length;
  }
  return result + text.slice(lastEnd);
}
