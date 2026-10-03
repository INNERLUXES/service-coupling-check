import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINDINGS, USAGE, VERSION, checkFiles, csvCell, main, mdCell, parseArgs, toCsv, toJson, toMarkdown, toText } from '../src/index.js';
import { HEALTH, check, cli, compose, run } from './helpers.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFile(resolve(root, rel), 'utf8');

// Runs the tool on files of the repository, with the root of the repository as the base for relative paths.
async function inRoot(argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } }, undefined, root);
  return { code, out, err };
}

const broken = () => compose({ api: { build: '.', depends_on: ['ghost'] }, db: { image: 'postgres' } });

test('text report: the files, the compose line, the areas, the services table, each finding with its quotation and fix, and the gate', () => {
  const out = toText(check(broken(), { path: 'compose.json' }));
  const lines = out.split('\n');
  assert.equal(lines[0], 'service-coupling-check: compose.json');
  assert.equal(lines[1], 'compose: 1 file, 2 services (1 application, 1 database, 0 broker), 0 references (0 depends_on, 0 links, 0 environment), chain limit 3, hub minimum 3');
  assert.equal(lines[2], 'areas:');
  assert.match(out, /^ {2}Startup order {5}fail {3}unknown-dependency x1$/m);
  assert.match(out, /^services:\n {2}service {2}kind {9}fan-in {2}fan-out {2}chain {2}healthcheck\n {2}api {6}application {7}0 {8}0 {6}0 {2}no$/m);
  assert.match(out, /^findings: 1 error, 0 warning, 1 info$/m);
  assert.match(out, /^ {2}ERROR {4}unknown-dependency {2}compose\.json #\/services\/api\/depends_on\/0 {2}line 1$/m);
  assert.match(out, /^ {11}basis: "The short syntax variant only specifies service names of the dependencies\." \(depends_on, short syntax, https:\/\/github\.com\/compose-spec\//m);
  assert.match(out, /^ {11}fix: Define the service "ghost"/m);
  assert.match(out, /^GATE: FAIL - 1 error$/m);
  assert.ok(out.endsWith('\n'));
});

test('text report: a file with no service says so in a note, before the gate', () => {
  const empty = toText(check(compose({})));
  assert.match(empty, /^no findings$/m);
  assert.match(empty, /\nnote: The files define no service, so there was nothing to check\n\nGATE: PASS \(--fail-on error\)\n$/);
  assert.ok(!empty.includes('services:'));
});

test('markdown report: the area table, the services table, a table per area, the notes as a list and the gate in bold', () => {
  const out = toMarkdown(check(broken(), { path: 'compose.json' }));
  assert.match(out, /^## service-coupling-check: 1 error, 0 warning, 1 info$/m);
  assert.match(out, /^\| Area \| Result \| Detail \|$/m);
  assert.match(out, /^\| Service \| Kind \| Fan-in \| Fan-out \| Chain \| Healthcheck \|$/m);
  assert.match(out, /^### Startup order$/m);
  assert.match(out, /^\| Severity \| Check \| Where \| Message \| Basis \| Fix \|$/m);
  assert.match(out, /\*\*Gate failed:\*\* 1 error\./);
  assert.match(toMarkdown(check(compose({ a: { image: 'x' } }))), /\*\*Gate passed\*\* \(--fail-on error\)\./);
});

test('markdown report: a pipe, a line break, an angle bracket, a link or a backtick in a service name cannot break a table or make markup', () => {
  const evil = 'a|b\nc<script>[click](https://evil.example.test)`x`';
  const r = check(compose({ [evil]: { build: '.', depends_on: ['ghost'] } }));
  const out = toMarkdown(r);
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes('[click]('));
  assert.ok(out.includes('a\\|b c&lt;script&gt;\\[click\\]'));
  for (const row of out.split('\n').filter((l) => l.startsWith('| error |'))) assert.equal(row.replace(/\\\|/g, '').split('|').length, 8, row.slice(0, 80));
  assert.equal(mdCell('x\r\ny'), 'x y');
  assert.equal(mdCell('\\'), '\\\\');
});

test('json report: the whole report, with the compose counts, the areas, the services, every finding with its basis, the notes and the gate', () => {
  const r = JSON.parse(toJson(check(broken(), { path: 'compose.json', version: '9.9.9' })));
  assert.deepEqual(Object.keys(r), ['tool', 'version', 'compose', 'areas', 'services', 'findings', 'notes', 'counts', 'gate']);
  assert.equal(r.tool, 'service-coupling-check');
  assert.equal(r.version, '9.9.9');
  assert.deepEqual(r.compose, { files: [{ path: 'compose.json', format: 'json', services: 2 }], services: 2, applications: 1, databases: 1, brokers: 0, references: 0, byKind: { depends_on: 0, links: 0, environment: 0 }, maxChain: 3, hubMin: 3 });
  assert.deepEqual(r.areas.map((a) => a.id), ['model', 'data', 'startup', 'coupling']);
  assert.deepEqual(Object.keys(r.findings[0]), ['id', 'severity', 'area', 'file', 'where', 'line', 'subject', 'message', 'fix', 'basis', 'source']);
  assert.deepEqual(Object.keys(r.findings[0].basis[0]), ['text', 'section', 'source']);
  assert.deepEqual(r.gate, { failOn: 'error', pass: false, reason: '1 error' });
});

test('csv report: RFC 4180, one row per finding, CRLF line ends, quotes doubled, and a leading quote on a cell a spreadsheet would run', () => {
  const r = check(compose({ '=HYPERLINK("x","y")': { build: '.', depends_on: ['ghost'] } }));
  const out = toCsv(r);
  const lines = out.split('\r\n');
  assert.equal(lines[0], 'severity,area,id,file,where,line,subject,message,basis,source,fix');
  assert.equal(lines.at(-1), '');
  assert.ok(lines[1].startsWith('error,startup,unknown-dependency,compose.json,'));
  assert.ok(out.includes('"\'=HYPERLINK(""x"",""y"")"'));
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@a'), "'@a");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('plain'), 'plain');
});

test('notes: include, extends, env_file, external_links, merged services, interpolation and --database that names nothing', () => {
  const doc = compose({
    a: { build: '.', extends: { service: 'base', file: 'common.yaml' }, env_file: '.env', external_links: ['legacy'], environment: { API: 'http://${API_HOST}:80' } },
    b: { build: '.' }
  }, { include: ['shared/compose.yaml'] });
  const r = check(doc, { databases: ['nothing'] });
  const all = r.notes.join('\n');
  assert.match(all, /has an include section \(line 1\) that was not followed: shared\/compose\.yaml/);
  assert.match(all, /The service "a" uses extends, which was not followed/);
  assert.match(all, /The service "a" reads variables from env_file, which was not read/);
  assert.match(all, /The service "a" has external_links to containers outside these files/);
  assert.match(all, /1 environment value writes its host with \$\{\.\.\.\}/);
  assert.match(all, /--database names "nothing", which is not a service in these files/);
  assert.match(all, /No service was read as a database/);
});

test('the usage text lists every check, the options and the exit codes', () => {
  for (const f of FINDINGS) assert.ok(USAGE.includes(f.id), f.id);
  assert.match(USAGE, /Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error\./);
  for (const o of ['--format <name>', '--fail-on <level>', '--max-chain <n>', '--hub-min <n>', '--database <service>']) assert.ok(USAGE.includes(o), o);
  assert.match(USAGE, /info never fails the run/);
});

test('exit code 0: a file with no finding at the level, and --help and --version', async () => {
  const clean = compose({ web: { build: '.', depends_on: { api: { condition: 'service_healthy' } } }, api: { build: '.', healthcheck: HEALTH } });
  assert.equal((await run({ 'c.json': clean }, ['c.json', '--fail-on', 'warning'])).code, 0);
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.equal(help.out, USAGE);
  const version = await cli(['--version']);
  assert.equal(version.code, 0);
  assert.equal(version.out, `${VERSION}\n`);
  assert.equal(VERSION, JSON.parse(await read('package.json')).version);
});

test('exit code 1: an error fails the default gate, a warning fails only --fail-on warning, and info never fails', async () => {
  const error = await run({ 'c.json': broken() }, ['c.json']);
  assert.equal(error.code, 1);
  assert.match(error.out, /GATE: FAIL - 1 error/);
  const warning = compose({ web: { build: '.', depends_on: ['api'] }, api: { build: '.' } });
  assert.equal((await run({ 'c.json': warning }, ['c.json'])).code, 0);
  assert.equal((await run({ 'c.json': warning }, ['c.json', '--fail-on', 'warning'])).code, 1);
  const info = compose({ a: { build: '.', environment: { DATABASE_URL: 'mysql://db/a' } }, b: { build: '.', environment: { DATABASE_URL: 'mysql://db/b' } }, db: { image: 'mysql' } });
  const infoRun = await run({ 'c.json': info }, ['c.json', '--fail-on', 'warning']);
  assert.equal(infoRun.code, 0);
  assert.match(infoRun.out, /shared-database-server/);
});

test('exit code 1: --max-chain, --hub-min and --database change what is found', async () => {
  const chain = compose({ a: { build: '.', links: ['b'] }, b: { build: '.', links: ['c'] }, c: { build: '.' } });
  assert.equal((await run({ 'c.json': chain }, ['c.json', '--fail-on', 'warning'])).code, 0);
  const deep = await run({ 'c.json': chain }, ['c.json', '--fail-on', 'warning', '--max-chain', '1']);
  assert.equal(deep.code, 1);
  assert.match(deep.out, /WARNING {2}deep-startup-chain/);
  const shared = compose({ a: { build: '.', links: ['store'] }, b: { build: '.', links: ['store'] }, store: { build: '.' } });
  assert.equal((await run({ 'c.json': shared }, ['c.json'])).code, 0);
  assert.equal((await run({ 'c.json': shared }, ['c.json', '--database', 'store'])).code, 1);
  const hub = compose({ a: { build: '.', links: ['u'] }, b: { build: '.', links: ['u'] }, u: { build: '.' } });
  assert.equal((await run({ 'c.json': hub }, ['c.json', '--fail-on', 'warning'])).code, 0);
  assert.equal((await run({ 'c.json': hub }, ['c.json', '--fail-on', 'warning', '--hub-min', '2'])).code, 1);
});

test('exit code 2: a usage error prints the reason and the usage to the error stream, and nothing to the output', async () => {
  for (const [args, message] of [
    [[], /give the path of a Compose file/],
    [['c.json', '--nope'], /unknown argument --nope/],
    [['c.json', '--format'], /--format needs a value/],
    [['c.json', '--format', 'xml'], /unknown format xml/],
    [['c.json', '--fail-on', 'info'], /--fail-on takes error or warning, not info/],
    [['c.json', '--max-chain', '0'], /--max-chain takes a whole number from 1 to 10000, not 0/],
    [['c.json', '--max-chain', 'many'], /--max-chain takes a whole number/],
    [['c.json', '--hub-min', '1'], /--hub-min takes a whole number from 2 to 10000/],
    [['c.json', '--database', ' '], /--database takes the name of a service/],
    [['c.json', 'c.json'], /the file c\.json is given twice/],
    [['https://example.test/compose.yaml'], /never fetches a URL/],
    [['-'], /standard input is not supported/]
  ]) {
    const r = await run({ 'c.json': broken() }, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.out, '');
    assert.match(r.err, message);
    assert.match(r.err, /Usage: service-coupling-check/);
  }
  const many = await run({}, Array.from({ length: 51 }, (_, i) => `f${i}.yaml`));
  assert.match(many.err, /give at most 50 files/);
});

test('exit code 2: an input that cannot be read is reported with its name and the reason, never as a pass', async () => {
  const cases = [
    [{}, ['missing.yaml'], /missing\.yaml: no such file/],
    [{ 'sub/a.yaml': 'services: {}\n' }, ['sub'], /sub: a folder, not a file/],
    [{ 'c.json': '{"services": {},}' }, ['c.json'], /c\.json: the JSON: line 1/],
    [{ 'c.yaml': 'services:\n  web: &a {}\n' }, ['c.yaml'], /c\.yaml: the YAML: line 2: an anchor/],
    [{ 'c.yaml': 'name: x\n' }, ['c.yaml'], /not a Compose file/],
    [{ 'ok.yaml': 'services: {}\n', 'bad.yaml': 'services: [\n' }, ['ok.yaml', 'bad.yaml'], /bad\.yaml: the YAML: line 1/]
  ];
  for (const [files, args, message] of cases) {
    const r = await run(files, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.out, '');
    assert.match(r.err, message);
  }
});

test('exit code 2: a file over the size limit is refused before it is read', async () => {
  const r = await run({ 'c.json': broken() }, ['c.json'], { maxFileBytes: 20 });
  assert.equal(r.code, 2);
  assert.match(r.err, /c\.json: [\d,]+ bytes is over the 20 byte limit/);
});

test('checkFiles: several files, their paths relative to the base, merged in order', async () => {
  const r = await checkFiles(['examples/shop-fixed.compose.yaml', 'examples/shop-fixed.override.yaml'], { base: root, failOn: 'warning' });
  assert.deepEqual(r.compose.files.map((f) => f.path), ['examples/shop-fixed.compose.yaml', 'examples/shop-fixed.override.yaml']);
  assert.equal(r.gate.pass, true);
});

test('paths in the report are relative to the base with forward slashes, for a file in a folder', async () => {
  const r = await run({ 'deploy/local/c.json': broken() }, ['deploy/local/c.json']);
  assert.match(r.out, /^service-coupling-check: deploy\/local\/c\.json$/m);
  assert.match(r.out, /ERROR {4}unknown-dependency {2}deploy\/local\/c\.json #/);
  const err = await run({}, ['deploy/none.yaml']);
  assert.match(err.err, /deploy\/none\.yaml: no such file/);
});

test('paths on Windows: a backslash separates the folders, and the report still shows forward slashes', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('a backslash is an ordinary character in a file name on this system');
    return;
  }
  const r = await run({ 'deploy/c.json': broken() }, ['deploy\\c.json']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^service-coupling-check: deploy\/c\.json$/m);
});

test('paths on Linux and macOS: a backslash is part of the file name, which is read under that name', async (t) => {
  if (process.platform === 'win32') {
    t.skip('a backslash separates folders on Windows');
    return;
  }
  const r = await run({ 'we\\ird.json': broken() }, ['we\\ird.json']);
  assert.equal(r.code, 1);
  assert.match(r.out, /we\\ird\.json/);
});

test('the example files: the broken shop fails with the findings the README names, the fixed one passes at the strictest level', async () => {
  const brokenRun = await inRoot(['examples/shop.compose.yaml', '--fail-on', 'warning']);
  assert.equal(brokenRun.code, 1);
  for (const f of FINDINGS.filter((x) => !['value-invalid', 'shared-database-server'].includes(x.id))) assert.ok(brokenRun.out.includes(`  ${f.id}  `), f.id);
  const fixed = await inRoot(['examples/shop-fixed.compose.yaml', 'examples/shop-fixed.override.yaml', '--fail-on', 'warning']);
  assert.equal(fixed.code, 0);
  assert.match(fixed.out, /findings: 0 error, 0 warning, 2 info/);
  const alone = await inRoot(['examples/shop-fixed.compose.yaml', '--fail-on', 'warning']);
  assert.equal(alone.code, 0, 'the fixed file passes without the override too');
  const jsonRun = await inRoot(['examples/shop.compose.json']);
  assert.equal(jsonRun.code, 1);
  assert.match(jsonRun.out, /value-invalid/);
});

test('the example output files are the real output, in every format', async () => {
  const args = ['examples/shop.compose.yaml', '--fail-on', 'warning'];
  assert.equal((await inRoot(args)).out, await read('examples/output/shop.txt'));
  assert.equal((await inRoot([...args, '--format', 'markdown'])).out, await read('examples/output/shop.md'));
  assert.equal((await inRoot([...args, '--format', 'json'])).out, await read('examples/output/shop.json'));
  const csv = (await inRoot([...args, '--format', 'csv'])).out;
  assert.equal(csv, await read('examples/output/shop.csv'));
  assert.ok(csv.includes('\r\n'));
  assert.equal((await inRoot(['examples/shop-fixed.compose.yaml', 'examples/shop-fixed.override.yaml', '--fail-on', 'warning'])).out, await read('examples/output/shop-fixed.txt'));
  assert.equal((await inRoot(['examples/shop.compose.json'])).out, await read('examples/output/shop-json.txt'));
});

test('parseArgs: the defaults, and options in any order', () => {
  assert.deepEqual(parseArgs(['c.yaml']), { files: ['c.yaml'], format: 'text', failOn: 'error', maxChain: 3, hubMin: 3, databases: [], help: false, version: false });
  assert.deepEqual(parseArgs(['--fail-on', 'warning', 'a.yaml', '--format', 'csv', '--max-chain', '5', '--hub-min', '4', '--database', 'store', '--database', 'cache', 'b.yaml']), { files: ['a.yaml', 'b.yaml'], format: 'csv', failOn: 'warning', maxChain: 5, hubMin: 4, databases: ['store', 'cache'], help: false, version: false });
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
});

test('the value of an environment variable is never printed, in any format', () => {
  const marker = 'MARKER-VALUE-42';
  const r = check(compose({
    a: { build: '.', environment: { DATABASE_URL: `postgres://user:${marker}@db/${marker}`, DB_HOST: 'db', DB_NAME: marker, OTHER: marker, PEER: `http://203.0.113.4/${marker}` } },
    b: { build: '.', environment: [`DATABASE_URL=postgres://u:${marker}@db/${marker}`] },
    db: { image: 'postgres' }
  }));
  assert.ok(r.findings.some((f) => f.id === 'shared-database'));
  for (const out of [toText(r), toMarkdown(r), toCsv(r), toJson(r)]) assert.ok(!out.includes(marker));
});
