// kuroshiro (Japanese → romaji) ships without types. Only the parts src/tts/spelling.ts uses are described here.
// Both are CommonJS. kuroshiro puts its class on `default`, so an ESM import gives { default: Class }; the analyzer
// exports its class directly.

declare module "kuroshiro" {
  interface ConvertOptions {
    to: "romaji" | "hiragana" | "katakana";
    mode?: "normal" | "spaced" | "okurigana" | "furigana";
    romajiSystem?: "nippon" | "passport" | "hepburn";
  }
  class Kuroshiro {
    init(analyzer: unknown): Promise<void>;
    convert(text: string, options: ConvertOptions): Promise<string>;
  }
  const module: { default: typeof Kuroshiro };
  export default module;
}

declare module "kuroshiro-analyzer-kuromoji" {
  export default class KuromojiAnalyzer {
    constructor(options?: { dictPath?: string });
  }
}
