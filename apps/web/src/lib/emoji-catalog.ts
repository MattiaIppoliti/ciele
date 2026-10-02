import nativeData from "@emoji-mart/data/sets/15/native.json";
import type { EmojiMartData } from "@emoji-mart/data";

const data: EmojiMartData = nativeData;

export interface PickerEmoji {
  id: string;
  native: string;
  name: string;
  words: string[];
}

const italianKeywords: Record<string, string> = {
  "😀": "sorriso felice felicita", "😁": "sorriso felice denti", "😂": "ridere risata lacrime divertente", "🤣": "ridere risata divertente",
  "😊": "sorriso felice timido", "😍": "amore innamorato occhi cuore", "🥰": "amore affetto innamorato", "😘": "bacio amore", "😢": "piangere triste lacrima", "😭": "piangere triste lacrime",
  "😮": "sorpresa sorpreso stupito", "🤔": "pensare dubbio domanda", "😡": "arrabbiato rabbia", "😎": "occhiali sole", "😅": "sudore imbarazzo", "😴": "dormire sonno", "🤩": "stelle entusiasmo",
  "👍": "pollice su bene bravo approvazione", "👎": "pollice giu male disapprovazione", "🙌": "mani alzate festa evviva", "👏": "applauso bravo complimenti", "🙏": "grazie preghiera mani", "👋": "ciao saluto mano", "💪": "forza muscolo braccio", "🤝": "accordo stretta mani", "🫶": "mani cuore amore",
  "❤️": "cuore rosso amore", "💜": "cuore viola amore", "💙": "cuore blu amore", "💚": "cuore verde amore", "🧡": "cuore arancione amore", "💛": "cuore giallo amore", "🖤": "cuore nero amore", "🤍": "cuore bianco amore", "💔": "cuore spezzato", "💕": "cuori amore",
  "🎉": "festa festeggiare coriandoli complimenti", "🎂": "torta compleanno", "🎁": "regalo dono", "🔥": "fuoco fiamma", "🚀": "razzo spazio lancio", "👀": "occhi guardare", "💡": "idea lampadina luce", "✅": "conferma spunta fatto", "⭐": "stella", "✨": "stelle scintille", "💯": "cento perfetto",
  "🐶": "cane cucciolo", "🐱": "gatto gattino", "🐾": "animali zampe", "🌸": "fiore primavera", "🌳": "albero natura", "☀️": "sole", "🌈": "arcobaleno", "🌧️": "pioggia", "🍕": "pizza cibo", "🍎": "mela frutta", "☕": "caffe tazza", "🍷": "vino", "🍺": "birra",
  "⚽": "calcio pallone sport", "🏀": "basket pallone sport", "🚗": "auto macchina", "✈️": "aereo viaggio", "🏠": "casa", "📚": "libri studio", "💻": "computer lavoro", "📱": "telefono cellulare", "🇮🇹": "italia italiano bandiera", "🇺🇸": "america stati uniti bandiera", "🇬🇧": "regno unito inglese bandiera", "🇫🇷": "francia francese bandiera", "🇩🇪": "germania tedesco bandiera", "🇪🇸": "spagna spagnolo bandiera",
};

export function normalizeEmojiSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[_:-]/g, " ").trim();
}

export const EMOJI_CATALOG: PickerEmoji[] = Object.values(data.emojis).flatMap((emoji) => {
  const native = emoji.skins[0]?.native;
  if (!native) return [];
  const words = normalizeEmojiSearch([emoji.id, emoji.name, ...emoji.keywords, italianKeywords[native] ?? ""].join(" ")).split(/\s+/);
  return [{ id: emoji.id, native, name: emoji.name, words: [...new Set(words)] }];
});
const byId = new Map(EMOJI_CATALOG.map((emoji) => [emoji.id, emoji]));
const validEmoji = new Set(Object.values(data.emojis).flatMap((emoji) => emoji.skins.map((skin) => skin.native)));

export function isReactionEmoji(value: unknown): value is string {
  return typeof value === "string" && validEmoji.has(value);
}

const people = data.categories.find((category) => category.id === "people")?.emojis ?? [];
const firstHand = people.indexOf("wave");
const categoryNames: Record<string, string> = { nature: "Animals and nature", foods: "Food and drink", activity: "Activity", places: "Travel and places", objects: "Objects", symbols: "Symbols", flags: "Flags" };
const categories = [
  { id: "smileys", name: "Smileys and emotion", emojis: people.slice(0, firstHand) },
  { id: "people", name: "People and body", emojis: people.slice(firstHand) },
  ...data.categories.filter((category) => category.id !== "people").map((category) => ({
    ...category,
    name: categoryNames[category.id] ?? category.id,
  })),
];
export const EMOJI_CATEGORIES = categories.map((category) => ({
  id: category.id, name: category.name,
  emojis: category.emojis.flatMap((id) => { const emoji = byId.get(id); return emoji ? [emoji] : []; }),
}));

/** Bounded edit distance, including adjacent transpositions ("haert" → "heart"). */
function typoDistance(query: string, word: string): number {
  if (Math.abs(query.length - word.length) > 2) return 3;
  let previous = Array.from({ length: word.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= query.length; i++) {
    const current = [i];
    for (let j = 1; j <= word.length; j++) {
      current[j] = Math.min((current[j - 1] ?? 0) + 1, (previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + (query[i - 1] === word[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && query[i - 1] === word[j - 2] && query[i - 2] === word[j - 1]) current[j] = Math.min(current[j] ?? 0, (beforePrevious[j - 2] ?? 0) + 1);
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[word.length] ?? 3;
}

export function searchEmoji(query: string): PickerEmoji[] {
  const normalized = normalizeEmojiSearch(query);
  if (!normalized) return EMOJI_CATALOG;
  const exactNative = EMOJI_CATALOG.filter((emoji) => emoji.native === query.trim());
  if (exactNative.length) return exactNative;
  const tokens = normalized.split(/\s+/);
  return EMOJI_CATALOG.flatMap((emoji) => {
    let score = 0;
    for (const token of tokens) {
      let best = Infinity;
      for (const word of emoji.words) {
        if (word === token) { best = 0; break; }
        if (word.startsWith(token)) best = Math.min(best, 1);
        else if (word.includes(token)) best = Math.min(best, 2);
        else if (token.length >= 3 && token.length <= 32) {
          const distance = typoDistance(token, word);
          if (distance <= (token.length >= 6 ? 2 : 1)) best = Math.min(best, 3 + distance);
        }
      }
      if (!Number.isFinite(best)) return [];
      score += best;
    }
    return [{ emoji, score }];
  }).sort((a, b) => a.score - b.score).map(({ emoji }) => emoji);
}
