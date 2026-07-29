import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  fromBlocks,
  textsOf,
  toBlocks,
  validate,
  wrapText,
  yamlScalar,
} from './mdx-blocks.mjs';

const CONTENT = path.join(import.meta.dirname, '../content/docs');

/** Feeding a document's own strings back must reproduce the document. */
function roundTrip(source) {
  const blocks = toBlocks(source);
  return fromBlocks(blocks, textsOf(blocks));
}

const flatten = (value) => value.replace(/\s+/g, ' ').trim();

test('code fences are never translatable', () => {
  const source = ['Prose here.', '', '```sh', 'pnpm install', '```', '', 'More prose.'].join('\n');
  assert.deepEqual(textsOf(toBlocks(source)), ['Prose here.', 'More prose.']);
});

test('imports and JSX blocks stay raw, but their copy attributes do not', () => {
  const source = [
    "import { Cards, Card } from 'fumadocs-ui/components/card';",
    '',
    '<Cards>',
    '  <Card',
    '    title="Getting started"',
    '    href="/getting-started"',
    '    description="From empty console to live widget."',
    '  />',
    '</Cards>',
  ].join('\n');
  assert.deepEqual(textsOf(toBlocks(source)), [
    'Getting started',
    'From empty console to live widget.',
  ]);
});

test('a Mermaid chart is left alone entirely', () => {
  const source = [
    '<Mermaid',
    '  title="One chat turn"',
    '  chart={`',
    'flowchart TB',
    '  A["Visitor message"] --> B["Reply"]',
    '`}',
    '/>',
  ].join('\n');
  // The title is copy; nothing inside the chart template literal is.
  assert.deepEqual(textsOf(toBlocks(source)), ['One chat turn']);
});

test('table dividers are raw, table rows are translatable', () => {
  const source = ['| Action | Effect |', '|---|---|', '| Send | Sends it |'].join('\n');
  assert.deepEqual(textsOf(toBlocks(source)), ['| Action | Effect |', '| Send | Sends it |']);
});

test('list items keep their marker and hanging indent', () => {
  const source = ['- **Assistants** — one chat experience you shape', '  from top to bottom.'].join(
    '\n',
  );
  const blocks = toBlocks(source);
  assert.deepEqual(textsOf(blocks), [
    '**Assistants** — one chat experience you shape from top to bottom.',
  ]);
  const output = fromBlocks(blocks, [
    'a much longer replacement sentence that has to wrap across more than one line to prove the indent',
  ]);
  const [first, second] = output.split('\n');
  assert.ok(first.startsWith('- '), first);
  assert.ok(second.startsWith('  ') && !second.startsWith('   '), second);
});

test('frontmatter is quoted only when the value needs it', () => {
  assert.equal(yamlScalar('Plain words'), 'Plain words');
  assert.equal(yamlScalar('Two editions: one core'), '"Two editions: one core"');
  assert.equal(yamlScalar('- leading dash'), '"- leading dash"');
  assert.equal(yamlScalar('true'), '"true"');

  const source = ['---', 'title: Editions', 'description: One core.', '---', '', 'Body.'].join('\n');
  const blocks = toBlocks(source);
  const output = fromBlocks(blocks, ['Edizioni', 'Due edizioni: un solo core.', 'Corpo.']);
  assert.match(output, /^description: "Due edizioni: un solo core\."$/m);
  assert.match(output, /^title: Edizioni$/m);
});

test('wrapText never breaks a link or a code span', () => {
  const value =
    'See the [installation guide for self-hosted deployments](/self-hosting/installation) and `NEXT_PUBLIC_SUPABASE_URL` for details.';
  const wrapped = wrapText(value, { prefix: '', indent: '' });
  for (const line of wrapped.split('\n')) {
    assert.equal((line.match(/`/g) ?? []).length % 2, 0, `unbalanced backticks: ${line}`);
    assert.ok(!/\[[^\]]*$/.test(line), `link split across lines: ${line}`);
  }
});

test('validate rejects a lost link target and a mangled fence', () => {
  const source = ['See [docs](/docs).', '', '```sh', 'pnpm i', '```'].join('\n');
  assert.deepEqual(validate(source, source), []);
  assert.ok(validate(source, 'See [docs](/documenti).').length > 0);
  assert.ok(validate(source, ['See [docs](/docs).', '```sh', 'pnpm i'].join('\n')).length > 0);
});

test('a CRLF document parses like an LF one', () => {
  // A Windows checkout hands the parser CRLF. A carriage return left on a line
  // used to hide the frontmatter fence from `indexOf('---')`, so the whole page
  // parsed as body and title/description were re-wrapped into a paragraph — a
  // failure Linux CI can never reproduce.
  const lf = [
    '---',
    'title: Appearance',
    'description: Match the widget to your brand.',
    '---',
    '',
    'Body prose.',
  ].join('\n');
  const crlf = lf.replace(/\n/g, '\r\n');

  assert.deepEqual(textsOf(toBlocks(crlf)), textsOf(toBlocks(lf)));
  assert.equal(roundTrip(crlf), roundTrip(lf));
  assert.deepEqual(validate(crlf, roundTrip(crlf)), []);
});

test('every English page round-trips without losing a word', async () => {
  const walk = async (dir) => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(full)));
      else if (entry.name.endsWith('.mdx') && !/\.[a-z]{2}\.mdx$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const files = await walk(CONTENT);
  assert.ok(files.length > 20, 'expected the English corpus to be found');

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const output = roundTrip(source);
    // Re-wrapping may move line breaks; it may not move words.
    assert.equal(flatten(output), flatten(source), path.relative(CONTENT, file));
    assert.deepEqual(validate(source, output), [], path.relative(CONTENT, file));
  }
});
