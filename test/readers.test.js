import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ADDRESS_LIMITS, FILE_LIMITS, JSON_LIMITS, MODEL_LIMITS, YAML_LIMITS, YamlError, addressesOf, displayPath, entryOf, escapeToken, fileError, formatOf, get,
  isHostVariable, isIP, isIPv4, isIPv6, isLocal, isMap, isObj, isScalar, isSeq, lineOf, parseFile, parseJson, parseYaml, pointerOf, propOf, readBounded,
  readCompose, readDocuments, resolveScalar, splitLines
} from '../src/index.js';
import { json, withFiles } from './helpers.js';

// ---- JSON -----------------------------------------------------------------------------------------------------------

test('parseJson: values with their lines, keys kept as a list, and the limits on depth and count', () => {
  const node = parseJson('{\n  "a": [1, true, null],\n  "b": "x"\n}');
  assert.equal(node.t, 'object');
  assert.deepEqual(node.props.map((p) => [p.key, p.line]), [['a', 2], ['b', 3]]);
  assert.equal(propOf(node, 'b').value.value, 'x');
  assert.throws(() => parseJson('{"a": 1, "a": 2}'), /the key "a" appears twice/);
  assert.throws(() => parseJson('{"a": 1,}'), /a key in quotes is expected/);
  assert.throws(() => parseJson('[[[1]]]', 'x', { limits: { maxDepth: 2, maxNodes: 10 } }), /nested more than 2 deep/);
  assert.throws(() => parseJson('[1,2,3]', 'x', { limits: { maxDepth: 5, maxNodes: 2 } }), /more than 2 values/);
  assert.equal(JSON_LIMITS.maxDepth, 64);
});

// ---- YAML -----------------------------------------------------------------------------------------------------------

const COMPOSE_YAML = `# a Compose file
services:
  web:
    image: "nginx:1.27"
    command: >
      nginx -g
      'daemon off;'
    depends_on: [api, 'db']
    environment: {MODE: prod, DEBUG: "no"}
    healthcheck:
      test: |
        curl -f http://localhost
  api:
    build: .
`;

test('parseYaml: block and flow collections, quoted, plain and block scalars, comments, with the line of every key', () => {
  const node = parseYaml(COMPOSE_YAML);
  assert.equal(node.t, 'object');
  const services = node.props[0];
  assert.equal(services.key, 'services');
  assert.equal(services.line, 2);
  const web = services.value.props[0].value;
  const field = (k) => web.props.find((p) => p.key === k);
  assert.equal(field('image').value.value, 'nginx:1.27');
  assert.equal(field('command').value.value, "nginx -g 'daemon off;'\n");
  assert.deepEqual(field('depends_on').value.items.map((i) => i.value), ['api', 'db']);
  assert.deepEqual(field('environment').value.props.map((p) => [p.key, p.value.value]), [['MODE', 'prod'], ['DEBUG', 'no']]);
  assert.equal(field('healthcheck').line, 10);
  assert.equal(parseYaml('a: yes\nb: 1.5\nc: ~\nd: true\n').props.map((p) => p.value.t).join(','), 'string,number,null,boolean');
  assert.deepEqual(parseYaml(''), { t: 'null', line: 1, value: null });
});

test('parseYaml: anchors, aliases, merge keys, tags (also !reset and !override), a second document and duplicate keys are refused with the line', () => {
  const cases = [
    ['x-base: &base\n  image: a\n', /line 1: an anchor/],
    ['services:\n  web: *base\n', /line 2: an alias/],
    ['services:\n  web:\n    <<: *base\n', /line 3: a merge key/],
    ['services:\n  web:\n    ports: !reset []\n', /line 3: a tag/],
    ['services:\n  web:\n    ports: !override\n      - "80:80"\n', /line 3: a tag/],
    ['services: {}\n---\nservices: {}\n', /line 3: a second document/],
    ['services:\n  web: {}\n  web: {}\n', /line 3: duplicate key "web"/],
    ['services:\n\tweb: {}\n', /line 2: a tab/]
  ];
  for (const [text, message] of cases) assert.throws(() => parseYaml(text, 'the YAML'), message, text);
});

test('readDocuments and the node helpers of the YAML reader', () => {
  const { documents, errors } = readDocuments('a: 1\n---\nb: [x]\n');
  assert.equal(documents.length, 2);
  assert.deepEqual(errors, []);
  const root = documents[1].root;
  assert.ok(isMap(root));
  assert.ok(isSeq(get(root, 'b')));
  assert.ok(isScalar(get(root, 'b').items[0]));
  assert.equal(entryOf(root, 'b').line, 3);
  assert.deepEqual(resolveScalar(get(documents[0].root, 'a')), { kind: 'integer', value: 1 });
  assert.deepEqual(splitLines('a\r\nb\rc\n'), ['a', 'b', 'c']);
  assert.ok(new YamlError(3, 'x') instanceof Error);
  assert.equal(YAML_LIMITS.maxDepth, 64);
});

// ---- files ----------------------------------------------------------------------------------------------------------

test('readBounded: a regular file under the limit is read; a folder, a missing file and a file over the limit are refused', async () => {
  await withFiles({ 'a.yaml': 'services: {}\n', 'big.yaml': 'x'.repeat(100) }, async (dir) => {
    assert.equal((await readBounded(resolve(dir, 'a.yaml'))).toString(), 'services: {}\n');
    await assert.rejects(readBounded(resolve(dir, 'missing.yaml')), /no such file/);
    await mkdir(resolve(dir, 'sub'));
    await assert.rejects(readBounded(resolve(dir, 'sub')), /a folder, not a file/);
    await assert.rejects(readBounded(resolve(dir, 'big.yaml'), 10), /100 bytes is over the 10 byte limit/);
  });
  assert.equal(FILE_LIMITS.maxFileBytes, 10 * 1024 * 1024);
  assert.equal(fileError('p', 'r').reason, 'r');
});

test('displayPath: relative with forward slashes inside the base, absolute outside it', () => {
  const base = resolve('/work/repo');
  assert.equal(displayPath(resolve(base, 'deploy/compose.yaml'), base), 'deploy/compose.yaml');
  assert.equal(displayPath(base, base), '.');
  assert.ok(displayPath(resolve('/elsewhere/c.yaml'), base).endsWith('elsewhere/c.yaml'));
  assert.ok(!displayPath(resolve('/elsewhere/c.yaml'), base).includes('\\'));
});

// ---- the Compose model ----------------------------------------------------------------------------------------------

test('formatOf and parseFile: JSON by name or by a first brace, YAML otherwise; pointers and lines', () => {
  assert.equal(formatOf('', 'compose.json'), 'json');
  assert.equal(formatOf('', 'compose.yml'), 'yaml');
  assert.equal(formatOf('  {"services": {}}', 'compose'), 'json');
  assert.equal(formatOf('services: {}', 'docker-compose'), 'yaml');
  const { data, lines, format } = parseFile('services:\n  a/b:\n    image: x\n', 'c.yaml');
  assert.equal(format, 'yaml');
  assert.equal(Object.getPrototypeOf(data), null);
  assert.equal(escapeToken('a/b~c'), 'a~1b~0c');
  assert.equal(pointerOf(['services', 'a/b', 'image']), '#/services/a~1b/image');
  assert.equal(lineOf(lines, '#/services/a~1b/image'), 3);
  assert.equal(lineOf(lines, '#/services/a~1b/missing'), 2);
  assert.equal(pointerOf([]), '#');
  assert.ok(isObj({}) && !isObj([]) && !isObj(null));
});

test('readCompose: the keys of a service, in both syntaxes, with the place of every value', () => {
  const m = readCompose([{ name: 'c.json', path: 'c.json', text: json({ services: { web: { image: 'nginx', container_name: 'front', hostname: 'h', depends_on: { api: { condition: 'service_healthy' } }, links: ['api:backend'], environment: ['A=1', 'B'], healthcheck: { test: 'true' }, networks: { n: { aliases: ['www'], ipv4_address: '203.0.113.2' } }, extends: { service: 'base', file: 'common.yaml' }, env_file: '.env', external_links: ['x'] }, api: null } }) }]);
  const web = m.services.get('web');
  assert.equal(web.image.value, 'nginx');
  assert.equal(web.containerName.value, 'front');
  assert.equal(web.dependsOn.get('api').condition, 'service_healthy');
  assert.equal(web.dependsOn.get('api').place.where, '#/services/web/depends_on/api');
  assert.deepEqual([...web.links.values()].map((l) => [l.target, l.alias]), [['api', 'backend']]);
  assert.deepEqual([...web.env.entries()].map(([k, v]) => [k, v.value, v.place.where]), [['A', '1', '#/services/web/environment/0'], ['B', null, '#/services/web/environment/1']]);
  assert.equal(web.healthcheck.state, 'declared');
  assert.deepEqual([...web.aliases.keys()], ['www']);
  assert.equal(web.ips[0].ip, '203.0.113.2');
  assert.deepEqual([web.extends.service, web.extends.file], ['base', 'common.yaml']);
  assert.ok(web.envFile && web.externalLinks);
  assert.ok(m.services.has('api'));
  assert.deepEqual(m.problems, []);
  assert.equal(MODEL_LIMITS.maxServices, 5000);
});

test('readCompose: include is listed and not followed; a file with neither services nor include is refused', () => {
  const m = readCompose([{ name: 'c.yaml', path: 'c.yaml', text: 'include:\n  - ../common/compose.yaml\n  - path: [a.yaml, b.yaml]\nservices:\n  web:\n    image: x\n' }]);
  assert.deepEqual(m.includes.map((i) => [i.file, i.place.line, i.paths]), [['c.yaml', 1, ['../common/compose.yaml', 'a.yaml', 'b.yaml']]]);
  assert.equal(readCompose([{ name: 'i.yaml', path: 'i.yaml', text: 'include:\n  - x.yaml\n' }]).services.size, 0);
  assert.throws(() => readCompose([{ name: 'c.yaml', path: 'c.yaml', text: 'version: "3"\n' }]), /c\.yaml: not a Compose file: there is no "services" mapping/);
  assert.throws(() => readCompose([{ name: 'c.yaml', path: 'c.yaml', text: '- a\n- b\n' }]), /not a Compose file: the file does not hold a mapping/);
  assert.throws(() => readCompose([{ name: 'c.yaml', path: 'c.yaml', text: 'services: [a]\n' }]), /"services" is not a mapping/);
});

test('readCompose: a healthcheck with settings only is partial, and a later file keeps a declared or disabled test', () => {
  const files = (a, b) => readCompose([{ name: '1.json', path: '1.json', text: json({ services: { s: { healthcheck: a } } }) }, { name: '2.json', path: '2.json', text: json({ services: { s: { healthcheck: b } } }) }]).services.get('s').healthcheck.state;
  assert.equal(files({ interval: '5s' }, { retries: 3 }), 'partial');
  assert.equal(files({ test: ['CMD', 'x'] }, { interval: '5s' }), 'declared');
  assert.equal(files({ disable: true }, { interval: '5s' }), 'disabled');
  assert.equal(files({ test: ['CMD', 'x'] }, { test: ['NONE'] }), 'disabled');
  assert.equal(files({ test: ['NONE'] }, { test: 'curl -f http://localhost' }), 'declared');
});

// ---- addresses ------------------------------------------------------------------------------------------------------

test('addressesOf: URLs, JDBC URLs, several hosts, user information, database names and schemes', () => {
  const a = (name, value) => addressesOf(name, value);
  assert.deepEqual(a('X', 'postgres://user:secret@db:5432/orders?sslmode=disable'), { scheme: 'postgres', hosts: [{ host: 'db', port: 5432 }], database: 'orders', interpolated: false, databaseScheme: true, tooLong: false });
  assert.deepEqual(a('X', 'jdbc:postgresql://db/shop').hosts, [{ host: 'db', port: null }]);
  assert.equal(a('X', 'jdbc:postgresql://db/shop').database, 'shop');
  assert.equal(a('X', 'jdbc:sqlserver://sql:1433;databaseName=orders').database, 'orders');
  assert.deepEqual(a('X', 'mongodb://m1:27017,m2:27017/app').hosts.map((h) => h.host), ['m1', 'm2']);
  assert.equal(a('X', 'http://api:8080/v1/items').databaseScheme, false);
  assert.deepEqual(a('X', 'http://[fd12:3456::5]:80/').hosts, [{ host: 'fd12:3456::5', port: 80 }]);
  assert.deepEqual(a('KAFKA', 'k1:9092,k2:9092').hosts.map((h) => h.port), [9092, 9092]);
  assert.deepEqual(a('DB_HOST', 'db').hosts, [{ host: 'db', port: null }]);
  assert.equal(a('MODE', 'db'), null, 'a bare word is an address only in a host variable');
  assert.equal(a('VERSION', '1.2:3'), null);
  assert.equal(a('X', 'hello world:80'), null);
  assert.equal(a('X', 42), null);
  assert.equal(a('X', ''), null);
  assert.equal(a('X', 'http://${API_HOST}:8080').interpolated, true);
  assert.equal(a('DB_HOST', '${DB_HOST:-db}').interpolated, true);
  assert.equal(a('X', 'postgres://u:${PASSWORD}@db/x').hosts[0].host, 'db', 'interpolation in the password only still gives the host');
  assert.equal(a('X', `http://${'a'.repeat(ADDRESS_LIMITS.maxValueChars)}`).tooLong, true);
});

test('IP addresses, local hosts and host variables', () => {
  assert.ok(isIPv4('203.0.113.7') && !isIPv4('256.1.1.1') && !isIPv4('1.2.3'));
  assert.ok(isIPv6('fd12:3456::1') && isIPv6('::1') && !isIPv6('db'));
  assert.ok(isIP('10.0.0.1') && !isIP('orders'));
  for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '0.0.0.0', '::1', 'host.docker.internal']) assert.ok(isLocal(h), h);
  for (const h of ['db', '10.0.0.1']) assert.ok(!isLocal(h), h);
  for (const n of ['DB_HOST', 'redis_host', 'HOST', 'KAFKA_SERVERS', 'API_ENDPOINT', 'CACHE_ADDR']) assert.ok(isHostVariable(n), n);
  for (const n of ['GHOST', 'HOSTED', 'DB_NAME']) assert.ok(!isHostVariable(n), n);
});
