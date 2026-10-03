import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MODEL_LIMITS, addressesOf, main, toCsv, toMarkdown, toText } from '../src/index.js';
import { check, compose, find, json, problems, run, withFiles } from './helpers.js';

// Hostile input: a Compose file that tries to exhaust the stack, the memory or the time, to make the tool read more than
// it was given, to rewrite the terminal, to break a table or to change how objects behave. Each test also checks the
// time, because a pattern or a walk that grows with the input is a failure even when the answer is right.

const LIMIT = { timeout: 30000 };
const fast = async (fn, ms = 4000) => {
  const start = Date.now();
  const result = await fn();
  assert.ok(Date.now() - start < ms, `took ${Date.now() - start} ms`);
  return result;
};

test('hostile: JSON nested a hundred thousand levels deep is refused with a message, not a stack overflow', LIMIT, async () => {
  const r = await fast(() => run({ 'c.json': `{"services": {}, "x": ${'['.repeat(100000)}${']'.repeat(100000)}}` }, ['c.json']));
  assert.equal(r.code, 2);
  assert.match(r.err, /nested more than 64 deep/);
});

test('hostile: YAML nested two hundred levels deep, in blocks or in flow brackets, is refused', LIMIT, async () => {
  let text = 'services:\n';
  for (let i = 0; i < 200; i += 1) text += `${'  '.repeat(i + 1)}k${i}:\n`;
  const r = await fast(() => run({ 'c.yaml': text }, ['c.yaml']));
  assert.equal(r.code, 2);
  assert.match(r.err, /nesting is deeper than 64 levels/);
  const flow = await fast(() => run({ 'c.yaml': `services: ${'['.repeat(5000)}${']'.repeat(5000)}\n` }, ['c.yaml']));
  assert.equal(flow.code, 2);
  assert.match(flow.err, /nesting is deeper than 64 levels/);
});

test('hostile: a file over the default size limit is refused from its size', LIMIT, async () => {
  await withFiles({}, async (dir) => {
    await writeFile(resolve(dir, 'big.yaml'), `services: {}\nx: ${'b'.repeat(10 * 1024 * 1024 + 10)}\n`);
    let err = '';
    const code = await fast(() => main(['big.yaml'], { out: () => {}, err: (t) => { err += t; } }, undefined, dir));
    assert.equal(code, 2);
    assert.match(err, /over the 10 MB limit/);
  });
});

test('hostile: a quote that is never closed, at the start of a 5 MB file, is refused in one pass', LIMIT, async () => {
  const r = await fast(() => run({ 'c.yaml': `services:\n  a:\n    image: "${'x '.repeat(2_500_000)}\n` }, ['c.yaml']));
  assert.equal(r.code, 2);
  assert.match(r.err, /c\.yaml: the YAML: line 3: a value is longer than|never closed/);
});

test('hostile: more services than the limit, and more values than the limit, are refused', LIMIT, async () => {
  const many = JSON.stringify({ services: Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`s${i}`, null])) });
  const r = await fast(() => run({ 'c.json': many }, ['c.json']));
  assert.equal(r.code, 2);
  assert.match(r.err, /more than 5,000 services/);
  const values = JSON.stringify({ services: {}, x: Array.from({ length: 600_000 }, () => 1) });
  assert.match((await fast(() => run({ 'c.json': values }, ['c.json']))).err, /more than 500,000 values/);
  const deps = Array.from({ length: 1001 }, (_, i) => `d${i}`);
  assert.throws(() => check(compose({ a: { depends_on: deps } })), /more than 1,000 entries in depends_on/);
  assert.equal(MODEL_LIMITS.maxEdges, 200_000);
});

test('hostile: a YAML alias bomb is never expanded, and every form of anchor, alias, tag and merge key is refused', LIMIT, async () => {
  const bomb = ['services: {}', 'a: &a [x, x, x, x, x, x, x, x, x]', 'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]', 'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]'].join('\n');
  const r = await fast(() => run({ 'bomb.yaml': bomb }, ['bomb.yaml']));
  assert.equal(r.code, 2);
  assert.match(r.err, /bomb\.yaml: the YAML: line 2: an anchor/);
  for (const text of ['x-common: &common\n  image: a\nservices:\n  web: *common\n', 'services:\n  web:\n    <<: *common\n', 'services:\n  web:\n    image: !!str x\n', 'services: !reset {}\n', 'services:\n  web: {image: *x}\n']) {
    const t = await run({ 'c.yaml': text }, ['c.yaml']);
    assert.equal(t.code, 2, text);
    assert.match(t.err, /anchor|alias|merge key|tag/);
  }
});

test('hostile: a chain of five thousand services and a loop through all of them end without a stack overflow, quickly', LIMIT, async () => {
  const n = 5000;
  const services = Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, { build: '.', depends_on: i + 1 < n ? { [`s${i + 1}`]: { condition: 'service_healthy' } } : {}, healthcheck: { test: 'true' } }]));
  const chain = await fast(() => check(compose(services)), 8000);
  assert.deepEqual(find(chain, 'dependency-cycle'), []);
  assert.deepEqual(problems(chain), ['deep-startup-chain']);
  assert.match(find(chain, 'deep-startup-chain')[0].message, /a chain of 4,999 services|a chain of 4999 services/);
  assert.ok(find(chain, 'deep-startup-chain')[0].message.length < 900);
  services[`s${n - 1}`].depends_on = { s0: { condition: 'service_healthy' } };
  const loop = await fast(() => check(compose(services)), 8000);
  assert.equal(find(loop, 'dependency-cycle').length, 1);
  assert.match(find(loop, 'dependency-cycle')[0].message, /and 4991 more/);
  assert.deepEqual(find(loop, 'deep-startup-chain'), []);
});

test('hostile: thousands of findings of one kind are listed up to the limit, counted in full, and quickly', LIMIT, async () => {
  const services = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`s${i}`, { build: '.', depends_on: [`ghost${i}`] }]));
  const r = await fast(() => check(compose(services)), 8000);
  assert.equal(find(r, 'unknown-dependency').length, MODEL_LIMITS.maxListedPerFinding);
  assert.equal(r.counts.error, 3000);
  assert.ok(r.notes.some((n) => /2,800 more findings of unknown-dependency/.test(n)));
});

test('hostile: long near misses for the address patterns take no longer than short ones', LIMIT, async () => {
  await fast(() => {
    for (const v of [`${'a'.repeat(4000)}:`, `${'1.'.repeat(2500)}`, `x://${'@'.repeat(4000)}`, `jdbc:${'a:'.repeat(1500)}//h`, `${'h:1,'.repeat(1000)}h`, `[${':'.repeat(4000)}]:1`]) {
      const a = addressesOf('DB_HOST', v);
      assert.ok(a === null || typeof a === 'object');
    }
    const env = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`V${i}_HOST`, `${'x'.repeat(1000)}.${i}:1`]));
    const r = check(compose({ a: { build: '.', environment: env } }));
    assert.ok(Array.isArray(r.findings));
  });
});

test('hostile: a service name made of control, direction and line separator characters is cleaned in every format', LIMIT, () => {
  const bad = ['x', String.fromCharCode(27), '[31m', String.fromCharCode(0x202e), 'y', String.fromCharCode(0x2028), 'z', String.fromCharCode(0), String.fromCharCode(0x85)].join('');
  const r = check(compose({ [bad]: { build: '.', depends_on: [`${bad}-ghost`] } }));
  assert.ok(r.findings.length >= 1);
  for (const out of [toText(r), toMarkdown(r), toCsv(r), JSON.stringify(r)]) {
    for (const code of [27, 0x202e, 0x2028, 0, 0x85]) assert.ok(!out.includes(String.fromCharCode(code)), `character ${code}`);
  }
});

test('hostile: a control character in a YAML file is refused, and the error message holds none', LIMIT, async () => {
  const r = await run({ 'c.yaml': `services:\n  a${String.fromCharCode(27)}[2J:\n    image: x\n` }, ['c.yaml']);
  assert.equal(r.code, 2);
  assert.match(r.err, /line 2: a control character/);
  assert.ok(!r.err.includes(String.fromCharCode(27)));
});

test('hostile: service names such as __proto__, constructor and toString are only names, in JSON and YAML', LIMIT, () => {
  const doc = compose({ __proto__x: null, constructor: { build: '.', depends_on: ['toString'] }, toString: { build: '.', depends_on: ['hasOwnProperty'] } });
  const viaJson = check(JSON.stringify(doc).replace('__proto__x', '__proto__'), { name: 'c.json' });
  assert.deepEqual(find(viaJson, 'unknown-dependency').map((f) => f.subject), ['toString']);
  assert.ok(viaJson.services.some((s) => s.name === '__proto__'));
  const viaYaml = check(['services:', '  __proto__:', '    build: .', '    depends_on: [constructor]', '  constructor:', '    build: .', ''].join('\n'));
  assert.deepEqual(find(viaYaml, 'unknown-dependency'), []);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal(Object.keys({}).length, 0);
});

test('hostile: a file with binary bytes, a null byte or a half character is refused or read as text, never a crash', LIMIT, async () => {
  for (const content of [Buffer.from([0, 1, 2, 3, 255, 254]), Buffer.from('services:\n  a\u0000b: {}\n'), Buffer.from([0x73, 0x3a, 0x0a, 0xc3, 0x28, 0x0a])]) {
    const r = await run({ 'c.yaml': content }, ['c.yaml']);
    assert.ok([0, 1, 2].includes(r.code));
    assert.ok(!r.out.includes(String.fromCharCode(0)) && !r.err.includes(String.fromCharCode(0)));
  }
  assert.equal((await run({ 'c.json': Buffer.from([0, 1, 2, 3, 255, 254]) }, ['c.json'])).code, 2);
});

test('hostile: an argument that is a URL, a very long path, or a path with control characters is refused or reported cleanly', LIMIT, async () => {
  const url = await run({}, ['https://example.test/compose.yaml']);
  assert.equal(url.code, 2);
  assert.match(url.err, /never fetches a URL/);
  const long = await run({}, [`${'a'.repeat(5000)}.yaml`]);
  assert.equal(long.code, 2);
  assert.ok(long.err.length < 8000);
  const control = await run({}, [`x${String.fromCharCode(27)}[31mfile.yaml`]);
  assert.equal(control.code, 2);
  assert.ok(!control.err.includes(String.fromCharCode(27)));
});

test('hostile: a file name with control characters is cleaned in the report, where the system allows such a name', LIMIT, async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows does not allow a control character in a file name');
    return;
  }
  const name = `evil${String.fromCharCode(27)}[31m.json`;
  let r;
  try {
    r = await run({ [name]: compose({ a: { build: '.' } }) }, [name]);
  } catch (error) {
    if (!['EINVAL', 'EILSEQ', 'ENOENT', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip(`this file system does not allow the name (${error.code})`);
    return;
  }
  assert.equal(r.code, 0);
  assert.ok(!r.out.includes(String.fromCharCode(27)));
});

test('hostile: a device or a pipe in place of the file is refused without being opened', LIMIT, async (t) => {
  if (process.platform === 'win32') {
    t.skip('there is no device file at this path on Windows');
    return;
  }
  const r = await run({}, ['/dev/null']);
  assert.equal(r.code, 2);
  assert.match(r.err, /not a regular file/);
});

test('hostile: a symbolic link to a folder is refused, and one to a file is followed because the person gave it', LIMIT, async (t) => {
  if (process.platform === 'win32') {
    t.skip('creating a symbolic link needs a privilege on Windows');
    return;
  }
  await withFiles({ 'real.json': json(compose({ a: { build: '.' } })) }, async (dir) => {
    await mkdir(resolve(dir, 'folder'));
    await symlink(resolve(dir, 'folder'), resolve(dir, 'dirlink'));
    await symlink(resolve(dir, 'real.json'), resolve(dir, 'filelink.json'));
    let err = '';
    assert.equal(await main(['dirlink'], { out: () => {}, err: (x) => { err += x; } }, undefined, dir), 2);
    assert.match(err, /a folder, not a file/);
    let out = '';
    assert.equal(await main(['filelink.json'], { out: (x) => { out += x; }, err: () => {} }, undefined, dir), 0);
    assert.match(out, /filelink\.json/);
  });
});

test('hostile: a file with thousands of services and references is checked in time', LIMIT, async () => {
  const services = {};
  for (let i = 0; i < 3000; i += 1) {
    services[`s${i}`] = { build: '.', healthcheck: { test: 'true' }, environment: { PEER_URL: `http://s${(i * 7) % 3000}:80`, DB_HOST: `db${i % 50}`, DB_NAME: `n${i}` } };
  }
  for (let k = 0; k < 50; k += 1) services[`db${k}`] = { image: 'postgres' };
  const r = await fast(() => check(compose(services)), 8000);
  assert.equal(r.compose.services, 3050);
  assert.equal(r.compose.databases, 50);
  assert.equal(find(r, 'shared-database-server').length, 50);
});
