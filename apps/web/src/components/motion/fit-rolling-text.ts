const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Scritto measures separate glyphs, without kerning. Keep whole graphemes. */
export function fitRollingText(text: string, width: number, measure: (glyph: string) => number): string {
  if (width <= 0) return "";
  const glyphs = Array.from(graphemes.segment(text), ({ segment }) => segment);
  const widths = glyphs.map(measure);
  if (widths.reduce((total, value) => total + value, 0) <= width) return text;
  const room = width - measure("…");
  if (room < 0) return "";
  let used = 0;
  let end = 0;
  while (end < glyphs.length && used + widths[end] <= room) used += widths[end++];
  return `${glyphs.slice(0, end).join("")}…`;
}
