import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_IMAGES, FACTS, imageName, isBrokerImage, isDatabaseImage } from '../src/index.js';
import { HEALTH, check, checkMany, compose, find, ids, problems, wheres } from './helpers.js';

// Each check has a Compose file small enough to work out by hand, written as JSON or as YAML, and a near miss that must
// not match.

const app = (extra = {}) => ({ build: '.', healthcheck: HEALTH, ...extra });
const healthy = (...names) => Object.fromEntries(names.map((n) => [n, { condition: 'service_healthy' }]));

test('a clean file has only the summary, and the gate passes at every level', () => {
  const r = check(compose({ web: app({ depends_on: healthy('api') }), api: app({ depends_on: healthy('db'), environment: { DATABASE_URL: 'postgres://u@db/api' } }), db: { image: 'postgres:16', healthcheck: HEALTH } }), { failOn: 'warning' });
  assert.deepEqual(ids(r), ['summary']);
  assert.equal(r.gate.pass, true);
  assert.deepEqual(r.counts, { error: 0, warning: 0, info: 1 });
});

// ---- shared-database --------------------------------------------------------------------------------------------------

test('shared-database: two services that reach one database, by depends_on, links or an address, are an error', () => {
  const r = check(compose({ a: app({ depends_on: healthy('db') }), b: app({ links: ['db'] }), c: app({ environment: { DB_HOST: 'db' } }), db: { image: 'postgres', healthcheck: HEALTH } }));
  assert.deepEqual(wheres(r, 'shared-database'), ['#/services/db']);
  const f = find(r, 'shared-database')[0];
  assert.match(f.message, /"a" \(depends_on\), "b" \(links\) and "c" \(DB_HOST\) all reach the database service "db"/);
  assert.match(f.message, /does not show that each one uses a database of its own/);
  assert.equal(f.basis[0].text, FACTS.keepPrivate.text);
});

test('shared-database: one service per database is not reported, and a database reached by another database is not counted', () => {
  const r = check(compose({ a: app({ depends_on: healthy('db1') }), b: app({ depends_on: healthy('db2') }), db1: { image: 'mysql', healthcheck: HEALTH }, db2: { image: 'mysql', healthcheck: HEALTH, environment: { PRIMARY_HOST: 'db1' } } }));
  assert.deepEqual(problems(r), []);
});

test('shared-database: the same database name in two addresses is an error that says so', () => {
  const r = check(compose({ a: app({ environment: { DATABASE_URL: 'postgres://a:x@db:5432/shop' } }), b: app({ environment: { JDBC: 'jdbc:postgresql://db/shop' } }), db: { build: '.', healthcheck: HEALTH } }));
  assert.match(find(r, 'shared-database')[0].message, /both reach the database service "db", and at least two of them name the same database/);
});

test('shared-database-server: each service names its own database on one server, which is info, not an error', () => {
  const doc = compose({
    a: app({ environment: { DATABASE_URL: 'postgres://a@db/orders' } }),
    b: app({ environment: { DB_HOST: 'db', DB_NAME: 'payments' } }),
    c: app({ environment: { POSTGRES_HOST: 'db', POSTGRES_DB: 'users' } }),
    db: { image: 'postgres', healthcheck: HEALTH }
  });
  const r = check(doc, { failOn: 'warning' });
  assert.deepEqual(problems(r), ['shared-database-server']);
  assert.equal(r.gate.pass, true);
  assert.match(find(r, 'shared-database-server')[0].message, /cannot show the credentials or the grants/);
  const missing = check(compose({ ...doc.services, d: app({ depends_on: healthy('db') }) }));
  assert.deepEqual(problems(missing), ['shared-database'], 'a service that names no database makes it an error');
});

test('databases: by image, by a database address, or by --database; a broker is not a database', () => {
  for (const image of ['postgres:16', 'docker.io/library/mongo:7@sha256:abc', 'bitnami/postgresql', 'mcr.microsoft.com/mssql/server:latest', 'redis']) assert.ok(isDatabaseImage(image), image);
  for (const image of ['nginx', 'postgres-exporter', '${DB_IMAGE}', 'my/redis-commander', undefined]) assert.ok(!isDatabaseImage(image), String(image));
  assert.ok(isBrokerImage('rabbitmq:3-management'));
  assert.deepEqual(imageName('registry.example.test:5000/team/postgres:16'), { last: 'postgres', lastTwo: 'team/postgres' });
  assert.equal(imageName('${X}'), null);
  assert.ok(DATABASE_IMAGES.includes('postgres'));
  const byAddress = check(compose({ a: app({ environment: { URL: 'mongodb://store:27017/a' } }), b: app({ depends_on: healthy('store') }), store: { build: '.', healthcheck: HEALTH } }));
  assert.equal(byAddress.compose.databases, 1);
  assert.deepEqual(problems(byAddress), ['shared-database']);
  const byOption = check(compose({ a: app({ depends_on: healthy('store') }), b: app({ depends_on: healthy('store') }), store: { build: '.', healthcheck: HEALTH } }), { databases: ['store'] });
  assert.deepEqual(problems(byOption), ['shared-database']);
  const broker = check(compose({ a: app({ depends_on: healthy('mq') }), b: app({ depends_on: healthy('mq') }), mq: { image: 'rabbitmq', healthcheck: HEALTH } }));
  assert.deepEqual(problems(broker), []);
  assert.equal(broker.compose.brokers, 1);
});

// ---- startup order ------------------------------------------------------------------------------------------------------

test('unknown-dependency: depends_on and links to a service that no file defines, in the short and the long syntax', () => {
  const r = check(compose({ a: app({ depends_on: ['ghost'], links: ['spirit:alias'] }), b: app({ depends_on: { phantom: { condition: 'service_healthy' } } }) }));
  assert.deepEqual(wheres(r, 'unknown-dependency'), ['#/services/a/depends_on/0', '#/services/a/links/0', '#/services/b/depends_on/phantom']);
  assert.ok(find(r, 'unknown-dependency').every((f) => f.severity === 'error'));
  const included = check(compose({ a: app({ depends_on: ['ghost'] }) }, { include: ['other.yaml'] }));
  assert.match(find(included, 'unknown-dependency')[0].message, /include other Compose files that were not read/);
});

test('dependency-cycle: a loop through depends_on and links, and a service that names itself; one finding per loop', () => {
  const r = check(compose({ a: app({ depends_on: healthy('b') }), b: app({ links: ['c'] }), c: app({ depends_on: healthy('a') }), d: app({ depends_on: healthy('d') }), e: app({ depends_on: healthy('a') }) }));
  assert.deepEqual(wheres(r, 'dependency-cycle'), ['#/services/a/depends_on/b', '#/services/d/depends_on/d']);
  assert.match(find(r, 'dependency-cycle')[0].message, /"a", "b" and "c" depend on each other in a loop/);
  assert.match(find(r, 'dependency-cycle')[1].message, /"d" names itself in depends_on/);
});

test('dependency-cycle: an address in the environment both ways is not a startup loop', () => {
  const r = check(compose({ a: app({ environment: { B_URL: 'http://b:80' } }), b: app({ environment: { A_URL: 'http://a:80' } }) }));
  assert.deepEqual(find(r, 'dependency-cycle'), []);
});

test('deep-startup-chain: a chain longer than the limit is reported once, at its top; the limit can be raised', () => {
  const chain = compose({ a: app({ depends_on: healthy('b') }), b: app({ depends_on: healthy('c') }), c: app({ depends_on: healthy('d') }), d: app({ links: ['e'] }), e: app() });
  const r = check(chain);
  assert.deepEqual(wheres(r, 'deep-startup-chain'), ['#/services/a/depends_on/b']);
  assert.match(find(r, 'deep-startup-chain')[0].message, /a chain of 4 services: a -> b -> c -> d -> e\. The limit is 3/);
  assert.deepEqual(find(check(chain, { maxChain: 4 }), 'deep-startup-chain'), []);
  assert.equal(find(check(chain, { maxChain: 1 }), 'deep-startup-chain').length, 1, 'only the top of the chain is reported');
  const three = compose({ a: app({ depends_on: healthy('b') }), b: app({ depends_on: healthy('c') }), c: app({ depends_on: healthy('d') }), d: app() });
  assert.deepEqual(find(check(three), 'deep-startup-chain'), [], 'three steps are within the default limit');
});

test('deep-startup-chain: the links inside a loop are not counted, so a loop does not make an endless chain', () => {
  const r = check(compose({ a: app({ depends_on: healthy('b') }), b: app({ depends_on: healthy('a', 'c') }), c: app() }));
  assert.deepEqual(problems(r), ['dependency-cycle']);
  assert.equal(r.services.find((s) => s.name === 'b').chain, 1);
});

test('depends-on-not-healthy: the short syntax or service_started on a service with a healthcheck; service_healthy and completed are fine', () => {
  const r = check(compose({ a: app({ depends_on: ['db'] }), b: app({ depends_on: { db: { condition: 'service_started' } } }), c: app({ depends_on: healthy('db') }), d: app({ depends_on: { job: { condition: 'service_completed_successfully' } } }), job: { build: '.' }, db: { build: '.', healthcheck: { interval: '5s' } } }));
  assert.deepEqual(wheres(r, 'depends-on-not-healthy'), ['#/services/a/depends_on/0', '#/services/b/depends_on/db']);
  assert.match(find(r, 'depends-on-not-healthy')[0].message, /with the short syntax/);
  assert.match(find(r, 'depends-on-not-healthy')[1].message, /with the condition service_started/);
  assert.deepEqual(find(r, 'no-healthcheck'), [], 'a one-shot job waited for with service_completed_successfully needs no healthcheck');
});

test('no-healthcheck: a service that others depend on and that declares or disables no healthcheck; one finding per service', () => {
  const r = check(compose({ a: { build: '.', depends_on: ['b', 'c'] }, x: { build: '.', depends_on: healthy('b') }, b: { build: '.' }, c: { build: '.', healthcheck: { disable: true } }, d: { build: '.', healthcheck: { test: ['NONE'] } }, lone: { build: '.' } }));
  assert.deepEqual(wheres(r, 'no-healthcheck'), ['#/services/b', '#/services/c/healthcheck']);
  assert.match(find(r, 'no-healthcheck')[0].message, /The services "a" and "x" depend on "b", which declares no healthcheck/);
  assert.match(find(r, 'no-healthcheck')[0].message, /"x" waits for it with service_healthy/);
  assert.match(find(r, 'no-healthcheck')[1].message, /The service "a" depends on "c", which disables its healthcheck/);
  assert.deepEqual(r.services.map((s) => s.healthcheck), ['no', 'no', 'no', 'disabled', 'disabled', 'no']);
});

// ---- coupling ---------------------------------------------------------------------------------------------------------

test('hub-service: most other application services reach one, at least --hub-min of them; a database or broker is never a hub', () => {
  const doc = compose({ a: app({ environment: { U: 'http://users:8080' } }), b: app({ depends_on: healthy('users') }), c: app({ links: ['users'] }), d: app(), users: app() });
  const r = check(doc);
  assert.deepEqual(wheres(r, 'hub-service'), ['#/services/users']);
  assert.match(find(r, 'hub-service')[0].message, /^3 of the 4 other application services reach "users": "a", "b" and "c"/);
  assert.deepEqual(find(check(doc, { hubMin: 4 }), 'hub-service'), []);
  const half = compose({ a: app({ depends_on: healthy('users') }), b: app({ depends_on: healthy('users') }), c: app({ depends_on: healthy('users') }), d: app(), e: app(), f: app(), users: app() });
  assert.deepEqual(find(check(half), 'hub-service'), [], '3 of 6 is not most');
  const mq = compose({ a: app({ depends_on: healthy('mq') }), b: app({ depends_on: healthy('mq') }), c: app({ depends_on: healthy('mq') }), mq: { image: 'nats', healthcheck: HEALTH } });
  assert.deepEqual(problems(check(mq)), []);
});

test('hardcoded-peer-address: an IP address in an environment value, once per variable; loopback and names are fine', () => {
  const r = check(compose({
    a: app({ environment: { PEER: 'http://203.0.113.5:8080/x', LIST: '203.0.113.6:9092,203.0.113.7:9092', SELF: 'http://127.0.0.1:8080', ANY: '0.0.0.0:8080', NAME: 'http://b:8080', V6: 'http://[fd12:3456::1]:80', VERSION: '1.2.3.4.5' } }),
    b: app({ networks: { back: { ipv4_address: '203.0.113.9' } } }),
    c: app({ environment: ['B_ADDR=203.0.113.9:80'] })
  }));
  assert.deepEqual(wheres(r, 'hardcoded-peer-address'), ['#/services/a/environment/LIST', '#/services/a/environment/PEER', '#/services/a/environment/V6', '#/services/c/environment/0'], 'one line of JSON: sorted by pointer');
  assert.match(find(r, 'hardcoded-peer-address')[0].message, /203\.0\.113\.6 and 203\.0\.113\.7 by IP address/);
  assert.match(find(r, 'hardcoded-peer-address')[3].message, /203\.0\.113\.9 \(the fixed address of "b"\)/);
  assert.ok(!JSON.stringify(r).includes('/x'), 'the rest of the value is not printed');
});

test('addresses resolve by service name, container_name, hostname, network alias and link alias, in any case', () => {
  const r = check(compose({
    a: app({ links: ['db:database'], environment: { A: 'http://CACHE-BOX:6379', B: 'http://database:1', C: 'http://api.internal:80', D: 'http://worker-1:80', E: 'http://unknown-host:80', F: 'redis://localhost:6379' } }),
    db: app(),
    cache: app({ container_name: 'cache-box' }),
    api: app({ networks: { front: { aliases: ['api.internal'] } } }),
    worker: app({ hostname: 'worker-1' })
  }));
  assert.deepEqual(r.services.find((s) => s.name === 'a').fanOut, 4);
  assert.equal(r.compose.references, 4);
});

test('summary: the counts, the highest fan-in and fan-out, at the services key; the services table in the report', () => {
  const r = check(compose({ web: app({ depends_on: healthy('api') }), api: app() }));
  assert.match(find(r, 'summary')[0].message, /^2 services \(2 application, 0 database, 0 broker\) with 1 reference between them \(1 by depends_on, 0 by links, 0 by environment\)\. The highest fan-in is "api" \(1\) and the highest fan-out is "web" \(1\)\.$/);
  assert.deepEqual(r.services, [{ name: 'web', kind: 'application', fanIn: 0, fanOut: 1, healthcheck: 'yes', chain: 1 }, { name: 'api', kind: 'application', fanIn: 1, fanOut: 0, healthcheck: 'yes', chain: 0 }]);
  assert.deepEqual(find(check(compose({})), 'summary'), []);
});

// ---- value-invalid and the model ----------------------------------------------------------------------------------------

test('value-invalid: each key in a shape the tool cannot read is an error, and the rest of the service is still read', () => {
  const r = check(compose({
    a: app({ depends_on: 'b', links: [3], environment: 'X=1', image: 7, healthcheck: 'yes' }),
    b: app({ depends_on: { c: { condition: 'service_ready' }, d: 'yes' }, environment: { OK: 'x', BAD: ['list'] } }),
    c: 'not a mapping',
    d: null
  }));
  assert.deepEqual(wheres(r, 'value-invalid'), ['#/services/a/depends_on', '#/services/a/environment', '#/services/a/healthcheck', '#/services/a/image', '#/services/a/links/0', '#/services/b/depends_on/c/condition', '#/services/b/depends_on/d', '#/services/b/environment/BAD', '#/services/c']);
  assert.equal(r.gate.pass, false);
  assert.match(find(r, 'value-invalid')[5].message, /one of service_started, service_healthy, service_completed_successfully/);
});

test('YAML and JSON: the same file gives the same findings, apart from the lines', () => {
  const yaml = ['services:', '  a:', '    build: .', '    depends_on: [db]', '    environment:', '      - DATABASE_URL=postgres://a@db/x', '  b:', '    build: .', '    depends_on:', '      db:', '        condition: service_started', '  db:', '    image: postgres', '    healthcheck:', '      test: pg_isready', ''].join('\n');
  const doc = compose({ a: { build: '.', depends_on: ['db'], environment: ['DATABASE_URL=postgres://a@db/x'] }, b: { build: '.', depends_on: { db: { condition: 'service_started' } } }, db: { image: 'postgres', healthcheck: { test: 'pg_isready' } } });
  const shape = (r) => r.findings.map((f) => [f.id, f.where, f.message]);
  assert.deepEqual(shape(check(yaml)), shape(check(doc)));
  assert.deepEqual(problems(check(yaml)), ['shared-database', 'depends-on-not-healthy', 'depends-on-not-healthy']);
});

test('several files: services are merged by name, depends_on by service, environment by variable, links appended', () => {
  const base = compose({ a: { build: '.', depends_on: ['db'], environment: { DB_HOST: 'db' } }, db: { image: 'postgres' } });
  const override = compose({ a: { depends_on: { db: { condition: 'service_healthy' } }, links: ['cache'], environment: { DB_HOST: 'other' } }, db: { healthcheck: HEALTH }, cache: { image: 'redis', healthcheck: HEALTH }, other: { image: 'postgres', healthcheck: HEALTH } });
  const r = checkMany([base, override], { failOn: 'warning' });
  assert.deepEqual(problems(r), [], 'the override sets the condition and the healthcheck');
  assert.deepEqual(r.services.map((s) => s.name), ['a', 'db', 'cache', 'other']);
  assert.equal(r.services[0].fanOut, 3, 'a reaches db by depends_on, cache by links, other by its variable');
  assert.ok(r.notes.some((n) => /"a" and "db" are defined in more than one file/.test(n)));
  const reverse = checkMany([override, base]);
  assert.deepEqual(problems(reverse), ['depends-on-not-healthy'], 'in the other order the short syntax of the second file wins');
});
