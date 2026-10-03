// Runs the README examples, checks that they report what the README shows, and writes the reports of the first example
// to examples/output. CI runs it and then fails if those files changed, so the example output in the repository is
// always the real output.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/index.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');

// Runs the tool on files of the repository; the paths shown in the report are relative to the root of the repository.
async function run(argv) {
  let out = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => process.stderr.write(t) }, undefined, root);
  return { code, out };
}

const problems = [];
function expect(name, result, code, expected, unwanted) {
  const missing = expected.filter((e) => !result.out.includes(e));
  const wrong = unwanted.filter((e) => result.out.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})`);
  }
}

const brokenArgs = ['examples/shop.compose.yaml', '--fail-on', 'warning'];
const broken = await run(brokenArgs);
process.stdout.write(broken.out);
expect('shop', broken, 1, [
  'compose: 1 file, 6 services (5 application, 1 database, 0 broker), 13 references (8 depends_on, 1 links, 9 environment), chain limit 3, hub minimum 3',
  'findings: 3 error, 10 warning, 1 info',
  'ERROR    shared-database  examples/shop.compose.yaml #/services/postgres',
  'ERROR    unknown-dependency  examples/shop.compose.yaml #/services/payments/depends_on/fraud-check',
  'ERROR    dependency-cycle  examples/shop.compose.yaml #/services/users/links/0',
  'WARNING  deep-startup-chain  examples/shop.compose.yaml #/services/gateway/depends_on/0',
  'WARNING  depends-on-not-healthy  examples/shop.compose.yaml #/services/orders/depends_on/1',
  'WARNING  no-healthcheck  examples/shop.compose.yaml #/services/catalog',
  'WARNING  hub-service  examples/shop.compose.yaml #/services/users',
  'WARNING  hardcoded-peer-address  examples/shop.compose.yaml #/services/payments/environment/USERS_ADDR',
  'INFO     summary  examples/shop.compose.yaml #/services',
  'GATE: FAIL - 3 errors, 10 warnings'
], ['GATE: PASS']);

process.stdout.write('\n');
const fixed = await run(['examples/shop-fixed.compose.yaml', 'examples/shop-fixed.override.yaml', '--fail-on', 'warning']);
process.stdout.write(fixed.out);
expect('fixed shop with --fail-on warning', fixed, 0, ['findings: 0 error, 0 warning, 2 info', 'INFO     shared-database-server', 'GATE: PASS (--fail-on warning)'], ['ERROR', 'WARNING ']);

const json = await run(['examples/shop.compose.json']);
expect('JSON shop', json, 1, [
  'compose: 1 file, 4 services (3 application, 1 database, 0 broker)',
  'ERROR    value-invalid  examples/shop.compose.json #/services/gateway/depends_on/payments/condition',
  'ERROR    shared-database  examples/shop.compose.json #/services/mysql',
  'WARNING  hardcoded-peer-address  examples/shop.compose.json #/services/gateway/environment/1',
  'GATE: FAIL - 2 errors'
], ['GATE: PASS']);

// The README shows the first two runs as they are printed.
const readme = (await readFile(resolve(root, 'README.md'), 'utf8')).split('\r\n').join('\n');
if (!readme.includes(broken.out)) problems.push('README: the sample output of the broken shop differs from a real run');
if (!readme.includes(fixed.out)) problems.push('README: the sample output of the fixed shop differs from a real run');

// The same files in the other formats, kept as examples of what each one looks like.
await mkdir(resolve(root, 'examples/output'), { recursive: true });
await writeFile(resolve(root, 'examples/output/shop.txt'), broken.out);
for (const [format, name] of [['markdown', 'shop.md'], ['json', 'shop.json'], ['csv', 'shop.csv']]) {
  const r = await run([...brokenArgs, '--format', format]);
  if (r.code !== 1) problems.push(`${format}: exit code ${r.code}, expected 1`);
  await writeFile(resolve(root, 'examples/output', name), r.out);
}
await writeFile(resolve(root, 'examples/output/shop-fixed.txt'), fixed.out);
await writeFile(resolve(root, 'examples/output/shop-json.txt'), json.out);

if (problems.length) {
  for (const p of problems) console.error(`example: ${p}`);
  process.exit(1);
}
