import { translation } from "../../platform/text";

const SOURCE_SCRIPTS: Record<string, string[]> = {
  ar: ["Arabic"],
  he: ["Hebrew"],
  hi: ["Devanagari"],
  ja: ["Han", "Hiragana", "Katakana"],
  ko: ["Hangul", "Han"],
  ru: ["Cyrillic"],
  uk: ["Cyrillic"],
  th: ["Thai"],
  "zh-Hans": ["Han"],
  "zh-Hant": ["Han"],
};

export function sourceLetters(source: string): string {
  const scripts = SOURCE_SCRIPTS[baseLanguage(source)];
  return scripts ? scripts.map((script) => `\\p{Script=${script}}`).join("|") : "\\p{L}";
}

export function baseLanguage(language: string): string {
  const [lang = "", second] = language.split(/[-_]/);
  if (lang.toLowerCase() === "zh") return second && /^(hant|tw|hk|mo)$/i.test(second) ? "zh-Hant" : "zh-Hans";
  return lang.toLowerCase();
}

let preferred: string[] | null = null;
export function userLanguages(): string[] {
  preferred ??= translation?.userLanguages() ?? [];
  return preferred;
}
export const defaultTarget = () => baseLanguage(userLanguages()[0] ?? "en");
export const languageName = (language: string) => translation?.languageName(language) ?? language;

export async function otherLanguages(): Promise<{ id: string; name: string }[]> {
  if (!translation) return [];
  const best = new Map<string, string>();
  for (const id of await translation.supportedLanguages()) {
    const key = baseLanguage(id);
    const current = best.get(key);
    if (!current || id.length < current.length) best.set(key, id);
  }
  return [...best.values()].map((id) => ({ id, name: languageName(id) })).sort((a, b) => a.name.localeCompare(b.name));
}
