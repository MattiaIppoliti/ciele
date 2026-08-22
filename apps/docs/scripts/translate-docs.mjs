#!/usr/bin/env node
/**
 * Generates the non-English documentation from the English source with Lara
 * Translate (https://laratranslate.com).
 *
 * English is the source of truth. Every other locale is a generated artifact
 * that is nonetheless committed: the pages stay reviewable in a diff, editable
 * by hand afterwards, and the site builds with no API key and no network.
 *
 *   LARA_ACCESS_KEY_ID=… LARA_ACCESS_KEY_SECRET=… pnpm translate:docs
 *
 * The two variables may also sit in apps/docs/.env.local, which .gitignore
 * excludes. That is what makes the run repeatable without a human pasting a
 * secret each time. Never commit them, and never put them in .env.example.
 *
 * Flags:
 *   --lang it,es     only these targets (default: every language but English)
 *   --only <substr>  only source paths containing <substr>
 *   --ui             also regenerate src/lib/ui-strings.ts
 *   --force          ignore the cache and retranslate
 *   --dry            report what would change, call nothing, write nothing
 *
 * Re-runs are incremental: scripts/.translation-cache.json remembers the hash
 * of the English source behind every generated file, so an edit to one page
 * retranslates that page only. A translation that fails validation
 * (mdx-blocks.mjs) is discarded and reported rather than written.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AccessKey, Translator } from '@translated/lara';
import { fromBlocks, textsOf, toBlocks, validate } from './mdx-blocks.mjs';

/**
 * Load apps/docs/.env.local into process.env, without a dependency and without
 * overriding anything the caller already exported. Only the two Lara keys are
 * read: this is a credential loader, not a general dotenv, and widening it
 * would make the script's inputs impossible to reason about.
 */
function loadLocalEnv(file) {
  if (!existsSync(file)) return;
  const wanted = new Set(['LARA_ACCESS_KEY_ID', 'LARA_ACCESS_KEY_SECRET']);
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!wanted.has(key) || process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

const ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT = path.join(ROOT, 'content/docs');
const CACHE_FILE = path.join(import.meta.dirname, '.translation-cache.json');
const UI_STRINGS_FILE = path.join(ROOT, 'src/lib/ui-strings.ts');

/** OneDrive and antivirus scanners can hold a generated file for a short time. */
async function writeGeneratedFile(file, content) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await writeFile(file, content);
      return;
    } catch (error) {
      const retryable = ['EBUSY', 'EPERM', 'UNKNOWN'].includes(error?.code);
      if (!retryable || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
}

/**
 * Locale → Lara language tag, the name the language calls itself, and the
 * register to address the reader in.
 *
 * The register is per-language on purpose: Italian and Spanish software
 * documentation has settled on the informal singular, while French and German
 * business documentation still expects the formal one. Left to itself Lara
 * reaches for the most deferential form available (capitalised *Lei*, *Suo*),
 * which reads like a bank letter rather than a product guide.
 */
const LOCALES = {
  en: { lara: 'en-US', displayName: 'English' },
  it: {
    lara: 'it-IT',
    displayName: 'Italiano',
    register:
      'Address the reader in the informal second person singular (tu). Never use the formal Lei/Suo/Vi forms.',
  },
  es: {
    lara: 'es-ES',
    displayName: 'Español',
    register:
      'Address the reader in the informal second person singular (tú). Do not use usted.',
  },
  fr: {
    lara: 'fr-FR',
    displayName: 'Français',
    register: 'Address the reader as vous, the standard register for French software documentation.',
  },
  de: {
    lara: 'de-DE',
    displayName: 'Deutsch',
    register: 'Address the reader as Sie, the standard register for German software documentation.',
  },
};
const SOURCE_LOCALE = 'en';

/**
 * Sent with every request. Lara is adaptive, so the register and the
 * "don't touch the syntax" rules matter more than any post-processing we could
 * do, the structural checks in mdx-blocks.mjs are the backstop, not the plan.
 */
const INSTRUCTIONS = [
  'This is product documentation for Ciele, a platform for building AI assistants. Keep the product name "Ciele" unchanged, and keep "Ciele Cloud" unchanged.',
  'Preserve Markdown and MDX syntax exactly: emphasis markers, backticks, table pipes, list markers, and link syntax. Translate the text of a link, never its URL.',
  'Never translate anything inside backticks: code identifiers, file paths, environment variable names, CLI commands, HTTP endpoints, and configuration keys stay in English.',
  // The admin console ships in English only. A reader following a translated
  // step has to find the control on screen, so the label has to match what is
  // printed on it, a translated button name is an unfindable button name.
  "The product's admin console is available in English only. Leave the names of interface elements exactly as written in English, section names, button labels, menu items, tab names, field names, and role names, including when they appear in bold. Translate the sentence around them.",
  'Keep placeholders such as {url} or {name} exactly as they appear.',
  'Use the vocabulary conventional for software documentation in the target language.',
];

const MAX_STRINGS_PER_CALL = 24;
const MAX_CHARS_PER_CALL = 6000;

function parseArgs(argv) {
  const args = { langs: null, only: null, ui: false, force: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang') args.langs = argv[++i]?.split(',').map((l) => l.trim());
    else if (arg === '--only') args.only = argv[++i];
    else if (arg === '--ui') args.ui = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--dry') args.dry = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return args;
}

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** `foo.mdx` → true; `foo.it.mdx` (a generated locale file) → false. */
function isEnglishSource(file) {
  const base = path.basename(file);
  if (base.endsWith('.mdx')) return !/\.[a-z]{2}\.mdx$/.test(base);
  if (base === 'meta.json') return true;
  return false;
}

function localeName(file, locale) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  if (base === 'meta.json') return path.join(dir, `meta.${locale}.json`);
  return path.join(dir, `${base.replace(/\.mdx$/, '')}.${locale}.mdx`);
}

/** Splits the strings of one document into request-sized chunks. */
function chunk(texts) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const value of texts) {
    if (
      current.length > 0 &&
      (current.length >= MAX_STRINGS_PER_CALL || chars + value.length > MAX_CHARS_PER_CALL)
    ) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(value);
    chars += value.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function createClient() {
  loadLocalEnv(path.join(ROOT, '.env.local'));
  const id = process.env.LARA_ACCESS_KEY_ID;
  const secret = process.env.LARA_ACCESS_KEY_SECRET;
  if (!id || !secret) {
    throw new Error(
      'Set LARA_ACCESS_KEY_ID and LARA_ACCESS_KEY_SECRET (Lara Translate access key), in the environment or in apps/docs/.env.local. Neither is ever committed.',
    );
  }
  return new Translator(new AccessKey(id, secret));
}

/**
 * Spans inside a sentence that must survive untranslated, sent to Lara as
 * non-translatable blocks rather than trusted to an instruction:
 *
 * - `` `code` ``, identifiers, paths, env vars, commands.
 * - `**Capitalized**`: an interface label. The English corpus is consistent
 *   about this: bold starting with a capital is something printed on screen
 *   (**General**, **Add button**, **Create a ticket**), bold starting lowercase
 *   is emphasis (**verbatim**, **required**). The console is English-only, so a
 *   translated label would send the reader looking for a control that does not
 *   exist.
 */
const PROTECTED_SPAN_RE = /`[^`]+`|\*\*[A-Z][^*]*\*\*/g;

/**
 * Masks the protected spans of a string as `{{n}}` placeholders.
 *
 * Placeholders rather than Lara's non-translatable blocks: a block is pinned to
 * its position in the sentence, which forces English word order around it
 * ("nella **General** sezione"). A placeholder is a token the model may move, so
 * the sentence comes back in the target language's own order with the label
 * dropped into the right slot. The cost is that a placeholder can be lost, which
 * `restore` refuses to paper over.
 */
function mask(value) {
  const spans = [];
  const masked = value.replace(PROTECTED_SPAN_RE, (span) => {
    spans.push(span);
    return `{{${spans.length}}}`;
  });
  return { masked, spans };
}

/**
 * Puts the protected spans back. Returns null when the translation did not
 * bring every placeholder back exactly once, the caller then retries that
 * string unmasked rather than writing a page with `{{2}}` in it.
 */
function restore(translated, spans) {
  let output = translated;
  for (let i = 0; i < spans.length; i++) {
    const token = `{{${i + 1}}}`;
    const occurrences = output.split(token).length - 1;
    if (occurrences !== 1) return null;
    output = output.replace(token, spans[i]);
  }
  return /\{\{\d+\}\}/.test(output) ? null : output;
}

async function callLara(lara, group, target, extraInstructions) {
  const response = await lara.translate(
    group,
    LOCALES[SOURCE_LOCALE].lara,
    LOCALES[target].lara,
    {
      instructions: [...INSTRUCTIONS, LOCALES[target].register, ...extraInstructions].filter(
        Boolean,
      ),
      style: 'faithful',
      priority: 'background',
      noTrace: true,
    },
  );
  const translated = Array.isArray(response.translation)
    ? response.translation
    : [response.translation];
  if (translated.length !== group.length) {
    throw new Error(`Lara returned ${translated.length} strings for ${group.length} inputs`);
  }
  return translated;
}

/**
 * Translates strings in order. Strings with no letters at all (a lone `**`, a
 * table divider) skip the round trip. Protected spans are masked first; any
 * string whose placeholders do not survive is retried unmasked, so the worst
 * case is a translated interface label rather than a broken page.
 */
async function translateAll(lara, texts, target, extraInstructions = []) {
  const needsWork = texts.map((value) => /\p{L}/u.test(value));
  const payloads = texts.filter((_, i) => needsWork[i]);
  const results = [];
  let retried = 0;

  for (const group of chunk(payloads)) {
    const masked = group.map(mask);
    const translated = await callLara(
      lara,
      masked.map((m) => m.masked),
      target,
      extraInstructions,
    );

    const restored = translated.map((value, i) => restore(value, masked[i].spans));
    const brokenIndexes = restored.flatMap((value, i) => (value === null ? [i] : []));
    if (brokenIndexes.length > 0) {
      retried += brokenIndexes.length;
      const plain = await callLara(
        lara,
        brokenIndexes.map((i) => group[i]),
        target,
        extraInstructions,
      );
      brokenIndexes.forEach((index, n) => (restored[index] = plain[n]));
    }
    results.push(...restored);
  }

  if (retried > 0) {
    console.warn(`  ⚠ ${retried} string(s) lost a placeholder and were retried unmasked`);
  }

  let cursor = 0;
  return texts.map((value, i) => (needsWork[i] ? results[cursor++] : value));
}

async function translateMdx(lara, source, target) {
  const blocks = toBlocks(source);
  const texts = textsOf(blocks);
  if (texts.length === 0) return { output: source, problems: [] };
  const translations = await translateAll(lara, texts, target);
  const output = fromBlocks(blocks, translations);
  return { output, problems: validate(source, output) };
}

/**
 * meta.json holds the sidebar: a title, a description, and `---Label---`
 * separators. Page slugs are routes and must survive untouched.
 */
async function translateMeta(lara, source, target) {
  const meta = JSON.parse(source);
  const fields = [];
  if (meta.title) fields.push({ set: (v) => (meta.title = v), value: meta.title });
  if (meta.description) fields.push({ set: (v) => (meta.description = v), value: meta.description });
  const pages = meta.pages ?? [];
  pages.forEach((entry, index) => {
    const separator = /^---(.+)---$/.exec(entry);
    if (separator) {
      fields.push({
        set: (v) => (pages[index] = `---${v}---`),
        value: separator[1],
      });
    }
  });
  if (fields.length === 0) return { output: source, problems: [] };
  const translations = await translateAll(
    lara,
    fields.map((f) => f.value),
    target,
    ['These are short navigation labels for a documentation sidebar. Translate them as UI labels, not as sentences, and always translate single common nouns.'],
  );
  fields.forEach((field, i) => field.set(translations[i]));
  const output = `${JSON.stringify(meta, null, 2)}\n`;
  const problems =
    JSON.parse(output).pages?.length === pages.length ? [] : ['page list length changed'];
  return { output, problems };
}

/**
 * The UI chrome (search box, pagination, theme switch). Fumadocs ships the keys
 * and the English defaults only; each key's trailing parenthetical is where the
 * string appears, which is exactly the context Lara needs.
 */
async function generateUiStrings(lara, targets) {
  const keysModule = await import('fumadocs-ui/i18n');
  const { keys } = keysModule.uiTranslations();
  const translatableKeys = keys.filter((key) => key !== 'displayName');
  const english = translatableKeys.map((key) => key.replace(/\((?:[^()]*)\)/g, '').trim());
  const contexts = translatableKeys.map((key) => (key.match(/\(([^()]*)\)/g) ?? []).join(' '));

  const bundles = { [SOURCE_LOCALE]: { displayName: LOCALES[SOURCE_LOCALE].displayName } };
  for (const target of targets) {
    const translations = await translateAll(lara, english, target, [
      'These are user-interface labels for a documentation website. Translate each one as a short UI label, in the same order.',
      `For context, each label appears in: ${contexts.join('; ')}.`,
    ]);
    const bundle = { displayName: LOCALES[target].displayName };
    translatableKeys.forEach((key, i) => (bundle[key] = translations[i]));
    bundles[target] = bundle;
  }

  const body = Object.entries(bundles)
    .map(([locale, bundle]) => {
      const entries = Object.entries(bundle)
        .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
        .join('\n');
      return `  ${locale}: {\n${entries}\n  },`;
    })
    .join('\n');

  return `/**
 * UI chrome strings per locale: search box, pagination, theme switch, page
 * actions. GENERATED by scripts/translate-docs.mjs (\`pnpm translate:docs --ui\`)
 * from the English keys fumadocs ships; edit a wording here and it survives
 * until the next regeneration, so prefer fixing it here and re-running with
 * --lang for content only.
 *
 * English is omitted on purpose beyond its display name: fumadocs' keys already
 * carry the English text.
 */
export const uiStrings = {
${body}
} as const;
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = (args.langs ?? Object.keys(LOCALES).filter((l) => l !== SOURCE_LOCALE)).filter(
    (locale) => {
      if (LOCALES[locale]) return true;
      throw new Error(`Unknown locale: ${locale}`);
    },
  );

  const cache = args.force
    ? {}
    : await readFile(CACHE_FILE, 'utf8')
        .then(JSON.parse)
        .catch(() => ({}));

  const files = (await walk(CONTENT))
    .filter(isEnglishSource)
    .filter((file) => !args.only || file.includes(args.only))
    .sort();

  const lara = args.dry ? null : createClient();
  const failures = [];
  let written = 0;
  let skipped = 0;

  for (const target of targets) {
    for (const file of files) {
      const rel = path.relative(CONTENT, file);
      const source = await readFile(file, 'utf8');
      const out = localeName(file, target);
      const key = `${target}:${rel}`;
      const fingerprint = hash(source);
      const exists = await stat(out).then(
        () => true,
        () => false,
      );
      if (cache[key] === fingerprint && exists) {
        skipped++;
        continue;
      }
      if (args.dry) {
        console.log(`would translate [${target}] ${rel}`);
        written++;
        continue;
      }

      const isMeta = path.basename(file) === 'meta.json';
      const { output, problems } = isMeta
        ? await translateMeta(lara, source, target)
        : await translateMdx(lara, source, target);

      if (problems.length > 0) {
        failures.push({ target, rel, problems });
        console.error(`✗ [${target}] ${rel}\n    ${problems.join('\n    ')}`);
        continue;
      }
      await writeGeneratedFile(out, output);
      cache[key] = fingerprint;
      written++;
      console.log(`✓ [${target}] ${rel}`);
      await writeGeneratedFile(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
    }
  }

  if (args.ui && !args.dry) {
    await writeGeneratedFile(UI_STRINGS_FILE, await generateUiStrings(lara, targets));
    console.log('✓ src/lib/ui-strings.ts');
  }

  console.log(`\n${written} written, ${skipped} unchanged, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
