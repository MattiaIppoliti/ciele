#!/usr/bin/env node
/** Translate the human-readable OpenAPI fields used by API Reference pages. */

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { AccessKey, Translator } from '@translated/lara';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'src/lib/openapi.generated.json');
const CACHE_FILE = path.join(ROOT, 'scripts/.translation-cache.json');
const LOCALES = {
  it: { target: 'it-IT', register: 'Use informal second-person singular (tu), never formal Lei.' },
  es: { target: 'es-ES', register: 'Use informal second-person singular (tú), never usted.' },
  fr: { target: 'fr-FR', register: 'Use vous, the standard register for French software documentation.' },
  de: { target: 'de-DE', register: 'Use Sie, the standard register for German software documentation.' },
};
const TRANSLATABLE_KEYS = new Set(['summary', 'description', 'title', 'x-displayName']);
const PROTECTED_SPAN_RE = /`[^`]+`|\*\*[A-Z][^*]*\*\*/g;

function loadCredentials() {
  const envFile = path.join(ROOT, '.env.local');
  if (existsSync(envFile)) {
    const wanted = new Set(['LARA_ACCESS_KEY_ID', 'LARA_ACCESS_KEY_SECRET']);
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match || !wanted.has(match[1]) || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const id = process.env.LARA_ACCESS_KEY_ID;
  const secret = process.env.LARA_ACCESS_KEY_SECRET;
  if (!id || !secret) throw new Error('Set LARA_ACCESS_KEY_ID and LARA_ACCESS_KEY_SECRET in apps/docs/.env.local or the environment.');
  return new Translator(new AccessKey(id, secret));
}

function collectStrings(value, pathParts = [], out = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectStrings(child, [...pathParts, index], out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    if (TRANSLATABLE_KEYS.has(key) && typeof child === 'string') {
      out.push({ path: [...pathParts, key], value: child });
    } else {
      collectStrings(child, [...pathParts, key], out);
    }
  }
  return out;
}

function setAtPath(value, pathParts, text) {
  let cursor = value;
  for (const part of pathParts.slice(0, -1)) cursor = cursor[part];
  cursor[pathParts.at(-1)] = text;
}

function mask(text) {
  const spans = [];
  const masked = text.replace(PROTECTED_SPAN_RE, (span) => {
    spans.push(span);
    return `{{${spans.length}}}`;
  });
  return { masked, spans };
}

function restore(text, spans) {
  let output = text;
  for (let index = 0; index < spans.length; index++) {
    const token = `{{${index + 1}}}`;
    if (output.split(token).length - 1 !== 1) return null;
    output = output.replace(token, spans[index]);
  }
  return /\{\{\d+\}\}/.test(output) ? null : output;
}

async function translateTexts(translator, values, locale) {
  const unique = [...new Set(values)];
  const translated = new Map();
  const groups = [];
  let current = [];
  let size = 0;
  for (const text of unique) {
    if (current.length && (current.length >= 24 || size + text.length > 6000)) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length) groups.push(current);

  for (const group of groups) {
    const masked = group.map(mask);
    const response = await translator.translate(
      masked.map(({ masked: text }) => text),
      'en-US',
      locale.target,
      {
        instructions: [
          'Translate Ciele product API documentation. Keep Ciele and Ciele Cloud unchanged.',
          'Preserve technical meaning, Markdown, placeholders, and all API semantics.',
          'Never translate text inside backticks, HTTP methods, field names, JSON keys, enum values, URLs, endpoint paths, identifiers, or code.',
          'Translate descriptions and human-readable summaries only. Keep the target language natural and concise.',
          locale.register,
        ],
        style: 'faithful',
        priority: 'background',
        noTrace: true,
      },
    );
    const result = Array.isArray(response.translation) ? response.translation : [response.translation];
    if (result.length !== group.length) throw new Error(`Lara returned ${result.length} translations for ${group.length} strings.`);
    const restored = result.map((text, index) => restore(text, masked[index].spans));
    const broken = restored.flatMap((text, index) => text === null ? [index] : []);
    if (broken.length) {
      const retry = await translator.translate(
        broken.map((index) => group[index]),
        'en-US',
        locale.target,
        {
          instructions: [
            'Translate Ciele product API documentation. Preserve all technical meaning, API identifiers, paths, keys, enum values, and code exactly.',
            locale.register,
          ],
          style: 'faithful',
          priority: 'background',
          noTrace: true,
        },
      );
      const retryResults = Array.isArray(retry.translation) ? retry.translation : [retry.translation];
      if (retryResults.length !== broken.length) throw new Error('Lara returned an incomplete retry translation.');
      broken.forEach((index, retryIndex) => { restored[index] = retryResults[retryIndex]; });
    }
    group.forEach((text, index) => translated.set(text, restored[index]));
  }
  return translated;
}

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), options: {
    lang: { type: 'string' },
    force: { type: 'boolean', default: false },
  } });
  const targets = (values.lang ? values.lang.split(',') : Object.keys(LOCALES)).map((lang) => lang.trim());
  for (const lang of targets) if (!LOCALES[lang]) throw new Error(`Unsupported locale: ${lang}`);

  const sourceText = await readFile(SOURCE_FILE, 'utf8');
  const source = JSON.parse(sourceText);
  const sourceHash = createHash('sha256').update(sourceText).digest('hex');
  let cache = await readFile(CACHE_FILE, 'utf8').then(JSON.parse).catch(() => ({}));
  const translator = createTranslatorIfNeeded();

  for (const lang of targets) {
    const outFile = path.join(ROOT, `src/lib/openapi.generated.${lang}.json`);
    const cacheKey = `openapi:${lang}`;
    if (!values.force && cache[cacheKey] === sourceHash && existsSync(outFile)) {
      console.log(`✓ [${lang}] OpenAPI contract unchanged`);
      continue;
    }
    const document = structuredClone(source);
    const fields = collectStrings(document);
    const translations = await translateTexts(translator, fields.map(({ value }) => value), LOCALES[lang]);
    for (const field of fields) setAtPath(document, field.path, translations.get(field.value));
    const output = `${JSON.stringify(document, null, 2)}\n`;
    JSON.parse(output);
    await writeFile(`${outFile}.tmp`, output);
    await rename(`${outFile}.tmp`, outFile);
    cache[cacheKey] = sourceHash;
    await writeFile(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
    console.log(`✓ [${lang}] translated ${fields.length} fields (${new Set(fields.map(({ value }) => value)).size} unique strings)`);
  }
}

function createTranslatorIfNeeded() {
  return loadCredentials();
}

await main();
