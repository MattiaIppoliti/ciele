/**
 * MDX → blocks → MDX, the part of the translation pipeline that has nothing to
 * do with any translation vendor.
 *
 * A block is either `raw` (emitted byte-for-byte: code fences, imports, JSX,
 * diagrams, blank lines) or a translatable `text` block carrying the prefix and
 * indent needed to put the translation back where it came from. Splitting this
 * out keeps it unit-testable without a network call, see mdx-blocks.test.mjs.
 */

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6}\s+)(.*)$/;
const LIST_RE = /^(\s*)([-*+]\s+|\d+\.\s+)(.*)$/;
const QUOTE_RE = /^(\s*>\s?)(.*)$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|[\s|:-]+\|\s*$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
/** A line that opens or continues MDX/JSX markup rather than prose. */
const JSX_OPEN_RE = /^\s*<[A-Za-z!/]/;
/** JSX attributes whose value is human-readable copy. */
const JSX_TEXT_ATTR_RE = /^(\s*)(title|description|label|alt|placeholder)=(["'])(.*)\3(\s*\/?>?\s*)$/;

/** Frontmatter keys whose values are prose. */
const FRONTMATTER_TEXT_KEYS = new Set(['title', 'description']);

/**
 * @typedef {{ type: 'raw', text: string }} RawBlock
 * @typedef {{ type: 'text', text: string, prefix: string, indent: string, wrap: boolean, suffix?: string }} TextBlock
 * @typedef {RawBlock | TextBlock} Block
 */

function raw(text) {
  return { type: 'raw', text };
}

function text(value, { prefix = '', indent = '', wrap = true, suffix = '', yaml = false } = {}) {
  return { type: 'text', text: value, prefix, indent, wrap, suffix, yaml };
}

/**
 * A YAML scalar that is safe unquoted, or a double-quoted one. Quoting is
 * decided from the value in hand rather than inherited from the source, since a
 * translation can introduce a colon where the English had none.
 */
export function yamlScalar(value) {
  const needsQuotes =
    /: |\s#|^\s|\s$|^$/.test(value) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /^(?:true|false|null|~|yes|no|on|off)$/i.test(value) ||
    /^[\d.+-]+$/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Splits a document into its frontmatter lines and its body lines. */
function splitFrontmatter(lines) {
  if (lines[0]?.trim() !== '---') return { front: [], body: lines };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { front: [], body: lines };
  return { front: lines.slice(0, end + 1), body: lines.slice(end + 1) };
}

function frontmatterBlocks(front) {
  const blocks = [];
  for (const line of front) {
    const match = /^([a-zA-Z_][\w-]*):\s*(.*)$/.exec(line);
    if (!match || !FRONTMATTER_TEXT_KEYS.has(match[1]) || !match[2].trim()) {
      blocks.push(raw(line));
      continue;
    }
    // Quoting is decided at emit time from the *translated* value, not copied
    // from the source: an unquoted English description translates into Spanish
    // with a colon in it ("dos ediciones: el núcleo…") and an unquoted YAML
    // scalar containing ": " is a parse error, not a string.
    const value = match[2];
    const inner =
      value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    blocks.push(text(inner, { prefix: `${match[1]}: `, wrap: false, yaml: true }));
  }
  return blocks;
}

/** True when the JSX element opened on `line` is still open after it. */
function jsxStaysOpen(line) {
  const opens = (line.match(/</g) ?? []).length;
  const selfClosing = (line.match(/\/>/g) ?? []).length;
  const closes = (line.match(/<\//g) ?? []).length;
  // Each `<` opens one element unless it is the `<` of a closing tag; `/>` and
  // `</` each account for one closed element.
  return opens - closes - selfClosing - closes > 0;
}

/**
 * Parses MDX into blocks.
 * @param {string} source
 * @returns {Block[]}
 */
export function toBlocks(source) {
  // Split on either ending, and keep no `\r` in a block. A Windows checkout hands
  // us CRLF, and a carriage return left on a line makes every structural probe
  // here miss: `indexOf('---')` no longer finds the frontmatter fence, so the
  // whole page parses as body and the frontmatter gets re-wrapped as prose. The
  // written file is LF, which is what the repo stores anyway.
  const lines = source.split(/\r?\n/);
  const { front, body } = splitFrontmatter(lines);
  const blocks = [...frontmatterBlocks(front)];

  let paragraph = null; // { lines: string[], prefix, indent }
  let inFence = false;
  let fenceMarker = '';
  let jsxDepth = 0;

  const flushParagraph = () => {
    if (!paragraph) return;
    blocks.push(
      text(paragraph.lines.join(' ').trim(), {
        prefix: paragraph.prefix,
        indent: paragraph.indent,
      }),
    );
    paragraph = null;
  };

  for (const line of body) {
    // ── code fences: everything between them is untouchable ────────────────
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph();
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1];
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false;
      }
      blocks.push(raw(line));
      continue;
    }
    if (inFence) {
      blocks.push(raw(line));
      continue;
    }

    // ── JSX / MDX markup, including multi-line components ──────────────────
    if (jsxDepth > 0 || JSX_OPEN_RE.test(line)) {
      flushParagraph();
      const attr = JSX_TEXT_ATTR_RE.exec(line);
      if (jsxDepth > 0 && attr) {
        blocks.push(
          text(attr[4], {
            prefix: `${attr[1]}${attr[2]}=${attr[3]}`,
            suffix: `${attr[3]}${attr[5]}`,
            wrap: false,
          }),
        );
      } else {
        blocks.push(raw(line));
      }
      if (jsxDepth === 0) {
        jsxDepth = jsxStaysOpen(line) ? 1 : 0;
      } else if (/^\s*(\/>|<\/)/.test(line) || /\/>\s*$/.test(line)) {
        jsxDepth = 0;
      }
      continue;
    }

    if (/^\s*(import|export)\s/.test(line) || HR_RE.test(line) || !line.trim()) {
      flushParagraph();
      blocks.push(raw(line));
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push(text(heading[2], { prefix: heading[1], wrap: false }));
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      flushParagraph();
      if (TABLE_DIVIDER_RE.test(line)) blocks.push(raw(line));
      else blocks.push(text(line.trim(), { wrap: false }));
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      if (paragraph?.prefix !== quote[1]) flushParagraph();
      paragraph ??= { lines: [], prefix: quote[1], indent: quote[1] };
      paragraph.lines.push(quote[2]);
      continue;
    }

    const list = LIST_RE.exec(line);
    if (list) {
      flushParagraph();
      paragraph = {
        lines: [list[3]],
        prefix: `${list[1]}${list[2]}`,
        indent: `${list[1]}${' '.repeat(list[2].length)}`,
      };
      continue;
    }

    // A continuation line of the paragraph or list item in progress.
    if (paragraph) {
      paragraph.lines.push(line.trim());
      continue;
    }
    paragraph = { lines: [line.trim()], prefix: '', indent: '' };
  }
  flushParagraph();
  return blocks;
}

/**
 * Greedy wrap that never breaks inside a Markdown link, inline code span, or
 * JSX expression: those are single tokens as far as wrapping is concerned.
 */
export function wrapText(value, { prefix, indent, width = 80 }) {
  const tokens = value.match(/(?:\[[^\]]*\]\([^)]*\)|`[^`]*`|\{[^}]*\}|\S)+/g) ?? [];
  const lines = [];
  let current = prefix;
  let isFirst = true;
  for (const token of tokens) {
    const candidate = current === (isFirst ? prefix : indent) ? current + token : `${current} ${token}`;
    if (candidate.length > width && current !== (isFirst ? prefix : indent)) {
      lines.push(current);
      current = indent + token;
      isFirst = false;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines.join('\n');
}

/**
 * Rebuilds a document from its blocks, given one translation per text block in
 * document order.
 * @param {Block[]} blocks
 * @param {string[]} translations
 */
export function fromBlocks(blocks, translations) {
  let cursor = 0;
  const out = [];
  for (const block of blocks) {
    if (block.type === 'raw') {
      out.push(block.text);
      continue;
    }
    const translated = translations[cursor++] ?? block.text;
    if (block.yaml) {
      out.push(`${block.prefix}${yamlScalar(translated)}`);
      continue;
    }
    if (!block.wrap) {
      out.push(`${block.prefix}${translated}${block.suffix ?? ''}`);
      continue;
    }
    out.push(
      wrapText(translated, { prefix: block.prefix, indent: block.indent }) +
        (block.suffix ?? ''),
    );
  }
  return out.join('\n');
}

/** The translatable strings of a document, in order. */
export function textsOf(blocks) {
  return blocks.filter((b) => b.type === 'text').map((b) => b.text);
}

/**
 * Structural checks on a translated document. Anything that fails means the
 * translation must be discarded rather than committed, a mangled fence or a
 * rewritten URL is worse than an untranslated page.
 * @returns {string[]} human-readable problems, empty when the output is sound
 */
export function validate(source, output) {
  const problems = [];
  const count = (value, re) => (value.match(re) ?? []).length;

  const fences = /^\s*(?:```|~~~)/gm;
  if (count(source, fences) !== count(output, fences)) {
    problems.push('code fence count changed');
  }

  const urls = (value) => new Set(value.match(/\]\(([^)\s]+)\)/g) ?? []);
  const sourceUrls = urls(source);
  const outputUrls = urls(output);
  for (const url of sourceUrls) {
    if (!outputUrls.has(url)) problems.push(`link target lost: ${url}`);
  }

  const components = (value) => {
    const found = new Map();
    for (const [, name] of value.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) {
      found.set(name, (found.get(name) ?? 0) + 1);
    }
    return found;
  };
  const sourceComponents = components(source);
  const outputComponents = components(output);
  for (const [name, n] of sourceComponents) {
    if (outputComponents.get(name) !== n) {
      problems.push(`component <${name}> count changed`);
    }
  }

  for (const key of FRONTMATTER_TEXT_KEYS) {
    const re = new RegExp(`^${key}:`, 'm');
    if (re.test(source) && !re.test(output)) problems.push(`frontmatter ${key} lost`);
  }

  if (/\bundefined\b/.test(output) && !/\bundefined\b/.test(source)) {
    problems.push('literal "undefined" in output');
  }

  return problems;
}
