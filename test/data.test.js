import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { BROKER_IMAGES, CONDITIONS, DATABASE_IMAGES, DATABASE_NAME_ENDINGS, DATABASE_SCHEMES, FACTS, FINDINGS, HEALTHCHECK_NONE, HOST_NAME_ENDINGS, KEYS, LOCAL_HOSTS, SOURCES, factPage, source } from '../src/index.js';

// These tests read the saved pages again and compare them with src/data.js: the Compose keys and conditions, and every
// sentence that a finding or a document quotes.

const text = async (id) => readFile(new URL(`../research/sources/${source(id).file}`, import.meta.url), 'utf8');
// Text compared without line breaks or runs of white space.
const flat = (t) => t.replace(/\s+/g, ' ').trim();
const has = (page, needle) => flat(page).includes(flat(needle));
// The words of a tool that wrote a text, built from pieces so that this file does not hold them.
const WRITTEN = new RegExp(`\\b(?:${['A', 'I'].join('')}|${['cha', 't'].join('')}|${['clau', 'de'].join('')}|${['anthro', 'pic'].join('')}|${['ope', 'nai'].join('')})\\b`, 'i');
const YEAR = /\b(?:19|20)\d{2}\b/;

test('sources: every saved page has its address on the first line, as listed in src/data.js, and holds text', async () => {
  for (const s of SOURCES) {
    const page = await text(s.id);
    assert.equal(page.split('\n')[0], `Source: ${s.url}`, s.file);
    assert.ok(page.length > 800, `${s.file} holds the page text`);
    assert.match(s.url, /^https:\/\//);
  }
  assert.equal(SOURCES.length, new Set(SOURCES.map((s) => s.url)).size);
  assert.equal(SOURCES.length, new Set(SOURCES.map((s) => s.file)).size);
  assert.equal(SOURCES.length, new Set(SOURCES.map((s) => s.id)).size);
});

test('sources: every file in research/sources is listed in src/data.js, and the other way round', async () => {
  const files = (await readdir(new URL('../research/sources/', import.meta.url))).sort();
  assert.deepEqual(files, SOURCES.map((s) => s.file).sort());
});

test('sources: the pages come from the Compose Specification, microservices.io and yaml.org', () => {
  assert.deepEqual(SOURCES.map((s) => new URL(s.url).host).sort(), ['github.com', 'github.com', 'github.com', 'microservices.io', 'microservices.io', 'yaml.org']);
  for (const s of SOURCES.filter((x) => x.url.includes('github.com'))) assert.match(s.url, /^https:\/\/github\.com\/compose-spec\/compose-spec\/blob\/main\/\d\d-[a-z]+\.md$/);
});

test('sources: no saved page holds a year, a mention of a tool that wrote it, a control byte, a carriage return or a character that is not ASCII', async () => {
  for (const s of SOURCES) {
    const page = await text(s.id);
    assert.doesNotMatch(page, YEAR, s.file);
    assert.doesNotMatch(page, WRITTEN, s.file);
    assert.doesNotMatch(page, new RegExp(`[${String.fromCharCode(1)}-${String.fromCharCode(8)}]`), s.file);
    assert.ok(!page.includes('\r'), s.file);
    assert.ok([...page].every((c) => c.charCodeAt(0) < 128), s.file);
  }
});

test('Compose keys: the keys, the three conditions and NONE are written on the services page', async () => {
  const page = await text('compose-services');
  for (const k of [KEYS.dependsOn, KEYS.links, KEYS.externalLinks, KEYS.environment, KEYS.healthcheck, KEYS.extends]) assert.ok(page.includes(`\n## ${k}\n`), k);
  for (const k of [KEYS.services, KEYS.condition, KEYS.test, `${KEYS.disable}: true`, KEYS.envFile]) assert.ok(page.includes(`\`${k}\``), k);
  assert.deepEqual(Object.values(CONDITIONS), ['service_started', 'service_healthy', 'service_completed_successfully']);
  for (const c of Object.values(CONDITIONS)) assert.ok(page.includes(`\`${c}\``), c);
  assert.ok(page.includes(`\`${HEALTHCHECK_NONE}\` disables the healthcheck`));
  assert.ok(has(page, 'Links also express implicit dependency between services in the same way as'), 'links decide the startup order too');
  assert.ok(has(await text('compose-include'), 'The `include` top-level section is used to define the dependency on another Compose application, or sub-domain.'));
});

test('YAML: the saved sections name the anchor, the alias and the tag that the reader refuses, and the merge page names !reset and !override', async () => {
  const page = await text('yaml-1.2.2');
  assert.ok(has(page, 'An anchor is denoted by the "&" indicator.'));
  assert.ok(has(page, 'An alias node is denoted by the "*" indicator.'));
  assert.ok(has(page, 'A tag is denoted by the "!" indicator.'));
  const merge = await text('compose-merge');
  assert.ok(merge.includes('`!reset`') && merge.includes('`!override`'));
});

test('facts: every quoted sentence is on its saved page, word for word, with no year and no mention of a tool that wrote it', async () => {
  for (const [key, fact] of Object.entries(FACTS)) {
    assert.ok(SOURCES.some((s) => s.id === fact.source), key);
    assert.ok(has(await text(fact.source), fact.text), `${key}: "${fact.text}"`);
    assert.ok(fact.section.length > 3, key);
    assert.doesNotMatch(fact.text, YEAR, key);
    assert.doesNotMatch(fact.text, WRITTEN, key);
    assert.ok(fact.text.length <= 220, `${key} is short`);
    assert.equal(factPage(key), source(fact.source).url);
  }
});

test('facts: every finding quotes sentences of src/data.js, and every source page is quoted at least once', () => {
  for (const f of FINDINGS) {
    assert.ok(['error', 'warning', 'info'].includes(f.severity), f.id);
    assert.match(f.id, /^[a-z]+(?:-[a-z]+)*$/, f.id);
    assert.ok(f.what.length > 20, f.id);
    assert.ok(f.facts.length >= 1, f.id);
    for (const k of f.facts) assert.ok(FACTS[k], `${f.id}: ${k}`);
  }
  const quoted = new Set(Object.values(FACTS).map((f) => f.source));
  for (const s of SOURCES) assert.ok(quoted.has(s.id), s.id);
  assert.deepEqual(FINDINGS.filter((f) => f.severity === 'error').map((f) => f.id), ['value-invalid', 'unknown-dependency', 'dependency-cycle', 'shared-database']);
  assert.deepEqual(FINDINGS.filter((f) => f.severity === 'warning').map((f) => f.id), ['deep-startup-chain', 'depends-on-not-healthy', 'no-healthcheck', 'hub-service', 'hardcoded-peer-address']);
  assert.deepEqual(FINDINGS.filter((f) => f.severity === 'info').map((f) => f.id), ['shared-database-server', 'summary']);
});

test('lists: the database, broker, scheme and host lists are lower case, have no duplicates and do not overlap', () => {
  for (const list of [DATABASE_IMAGES, BROKER_IMAGES, DATABASE_SCHEMES, LOCAL_HOSTS]) {
    assert.equal(new Set(list).size, list.length);
    for (const x of list) assert.equal(x, x.toLowerCase(), x);
  }
  for (const x of DATABASE_IMAGES) assert.ok(!BROKER_IMAGES.includes(x), x);
  for (const x of ['postgres', 'mysql', 'mariadb', 'mongo', 'redis']) assert.ok(DATABASE_IMAGES.includes(x), x);
  for (const x of ['postgres', 'postgresql', 'mysql', 'mongodb', 'redis']) assert.ok(DATABASE_SCHEMES.includes(x), x);
  for (const x of [...HOST_NAME_ENDINGS, ...DATABASE_NAME_ENDINGS]) assert.equal(x, x.toUpperCase(), x);
});

test('src writes no Compose key outside src/data.js', async () => {
  const names = ['depends_on', 'links', 'external_links', 'environment', 'env_file', 'healthcheck', 'container_name', 'hostname', 'extends', 'include', 'service_started', 'service_healthy', 'service_completed_successfully', 'ipv4_address', 'ipv6_address', 'aliases'];
  for (const file of ['rules.js', 'check.js', 'compose.js', 'address.js', 'report.js', 'cli.js']) {
    const lines = (await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')).split(String.fromCharCode(10));
    const code = lines.filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10));
    for (const n of names) assert.ok(!code.includes(`'${n}'`) && !code.includes(`"${n}"`), `${file} writes '${n}' itself`);
  }
});

test('docs: every sentence that the documents quote from a saved page is on a saved page', async () => {
  const pages = (await Promise.all(SOURCES.map((s) => text(s.id)))).map(flat).join(' ');
  let checked = 0;
  for (const file of ['docs/method.md', 'docs/rules-and-sources.md', 'docs/inputs.md', 'docs/limits.md', 'docs/decisions/0001-read-the-compose-file-not-the-running-system.md', 'README.md']) {
    const doc = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const prose = file === 'README.md' ? doc.replace(/```[\s\S]*?```/g, '') : doc;
    for (const m of prose.matchAll(/"([^"\n]{40,400})"/g)) {
      assert.ok(pages.includes(flat(m[1])), `${file}: ${m[1]}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 40, `${checked} quotes checked`);
});

test('docs: docs/rules-and-sources.md names every saved page, every quoted sentence and every finding', async () => {
  const doc = await readFile(new URL('../docs/rules-and-sources.md', import.meta.url), 'utf8');
  for (const s of SOURCES) {
    assert.ok(doc.includes(s.file), s.file);
    assert.ok(doc.includes(s.url), s.url);
  }
  for (const [key, fact] of Object.entries(FACTS)) assert.ok(doc.includes(`| \`${key}\` |`) && doc.includes(fact.text), key);
  for (const f of FINDINGS) {
    assert.ok(doc.includes(`| \`${f.id}\` | ${f.severity} |`), f.id);
    assert.ok(doc.includes(`(method.md#${f.id}-${f.severity})`), f.id);
    for (const k of f.facts) assert.ok(new RegExp(`\\| \`${k}\` \\| [^|]*\`${f.id}\``).test(doc), `${k} is used by ${f.id}`);
  }
});
