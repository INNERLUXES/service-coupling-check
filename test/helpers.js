// Shared test helpers: Compose files built inline, and files written into a temporary folder that is removed after the
// test. Paths are built with resolve() from forward-slash names, so the same test runs on Linux, macOS and Windows.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { checkText, checkTexts, main } from '../src/index.js';

export async function withFiles(files, fn) {
  const dir = await mkdtemp(resolve(tmpdir(), 'service-coupling-check-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(resolve(dir, rel)), { recursive: true });
      await writeFile(resolve(dir, rel), content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// A healthcheck that declares a test.
export const HEALTH = { test: ['CMD', 'true'] };

// A Compose document with these services.
export const compose = (services, extra = {}) => ({ ...extra, services });

// Checks a Compose document given as an object (written as JSON) or as YAML text.
export function check(doc, options = {}) {
  const text = typeof doc === 'string' ? doc : JSON.stringify(doc);
  return checkText(text, options.name ?? (typeof doc === 'string' ? 'compose.yaml' : 'compose.json'), { ...options });
}

// Checks several documents as several files, merged in order.
export function checkMany(docs, options = {}) {
  return checkTexts(docs.map((d, i) => ({ text: typeof d === 'string' ? d : JSON.stringify(d), name: `f${i}.${typeof d === 'string' ? 'yaml' : 'json'}`, path: `f${i}.${typeof d === 'string' ? 'yaml' : 'json'}` })), options);
}

export const ids = (report) => report.findings.map((f) => f.id);
export const find = (report, id) => report.findings.filter((f) => f.id === id);
export const wheres = (report, id) => find(report, id).map((f) => f.where);
// The finding ids without the summary line, which every file with a service has.
export const problems = (report) => ids(report).filter((id) => id !== 'summary');

// Writes the files (objects are written as JSON, strings as they are) and runs the command line with these arguments
// (paths relative to the folder).
export async function run(files, args = [], limits) {
  const written = {};
  for (const [name, content] of Object.entries(files)) written[name] = typeof content === 'string' || Buffer.isBuffer(content) ? content : json(content);
  return withFiles(written, async (dir) => {
    let out = '';
    let err = '';
    const code = await main(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, limits, dir);
    return { code, out, err };
  });
}

// Runs the command line with exactly these arguments.
export async function cli(argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
}
