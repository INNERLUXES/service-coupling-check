// The checks. Each one reads the merged Compose model and reports what the files themselves show about how the services
// are coupled. docs/method.md gives the reason behind every finding and says what each check can and cannot see.
// Nothing here opens a connection or runs a program. A finding names services by their name, environment variables by
// their name, and a fixed address by its IP; the rest of the value of a variable is never copied into a finding.

import { BROKER_IMAGES, CONDITIONS, DATABASE_IMAGES, DATABASE_NAME_ENDINGS, FACTS, HOST_NAME_ENDINGS, KEYS, factPage } from './data.js';
import { addressesOf, isHostVariable, isIP, isLocal } from './address.js';
import { MODEL_LIMITS } from './compose.js';

export const SEVERITIES = ['error', 'warning', 'info'];
export const RANK = { error: 0, warning: 1, info: 2 };

// The areas a report is grouped by, in report order.
export const AREAS = [
  { id: 'model', title: 'Compose model' },
  { id: 'data', title: 'Data ownership' },
  { id: 'startup', title: 'Startup order' },
  { id: 'coupling', title: 'Coupling' }
];

// Every finding, in report order within a severity. facts are the keys of the sentences of src/data.js that the finding
// quotes; the page of the first one is the finding's source.
export const FINDINGS = [
  { id: 'value-invalid', severity: 'error', area: 'model', what: 'A key of a service is in a shape the tool cannot read', facts: ['servicesMap'] },
  { id: 'unknown-dependency', severity: 'error', area: 'startup', what: 'depends_on or links names a service that no file defines', facts: ['shortSyntax', 'startedGuarantee'] },
  { id: 'dependency-cycle', severity: 'error', area: 'startup', what: 'Services depend on each other in a loop through depends_on or links', facts: ['dependencyOrder', 'removeOrder'] },
  { id: 'shared-database', severity: 'error', area: 'data', what: 'Two or more services reach the same database service, and the files do not show that each one uses its own database on it', facts: ['keepPrivate', 'developmentCoupling'] },
  { id: 'deep-startup-chain', severity: 'warning', area: 'startup', what: 'A chain of depends_on and links is longer than the limit', facts: ['startedGuarantee', 'looselyCoupled'] },
  { id: 'depends-on-not-healthy', severity: 'warning', area: 'startup', what: 'depends_on waits only for the start of a service that has a healthcheck', facts: ['startedGuarantee', 'waitHealthy'] },
  { id: 'no-healthcheck', severity: 'warning', area: 'startup', what: 'Other services depend on a service that declares no healthcheck', facts: ['waitHealthy', 'healthcheckOverride'] },
  { id: 'hub-service', severity: 'warning', area: 'coupling', what: 'Most other application services reach one application service', facts: ['serviceDefinition', 'looselyCoupled'] },
  { id: 'hardcoded-peer-address', severity: 'warning', area: 'coupling', what: 'An environment value reaches another service by a fixed IP address instead of its name', facts: ['reachByName', 'linkedHostname'] },
  { id: 'shared-database-server', severity: 'info', area: 'data', what: 'Several services reach one database server, and each names a database of its own on it', facts: ['noServerEach', 'logicalDatabase'] },
  { id: 'summary', severity: 'info', area: 'coupling', what: 'The services, the references between them, and the highest fan-in and fan-out', facts: ['serviceDefinition'] }
];

const BY_ID = Object.fromEntries(FINDINGS.map((f) => [f.id, f]));
export const ORDER = Object.fromEntries(FINDINGS.map((f, i) => [f.id, i]));
export const BY_ID_SEVERITY = Object.fromEntries(FINDINGS.map((f) => [f.id, f.severity]));
export const AREA_ORDER = Object.fromEntries(AREAS.map((a, i) => [a.id, i]));

export const DEFAULT_MAX_CHAIN = 3;
export const DEFAULT_HUB_MIN = 3;
export const MAX_OPTION = 10_000;

// Control characters (C0 and C1), the line and paragraph separators and the Unicode direction controls, built from
// their code points so that this file holds only ASCII.
const span = (a, b) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
const UNSAFE_CHARACTERS = new RegExp(`[${span(0, 0x1f)}${span(0x7f, 0x9f)}${[0x200e, 0x200f, 0x2028, 0x2029].map((c) => String.fromCharCode(c)).join('')}${span(0x202a, 0x202e)}${span(0x2066, 0x2069)}]`, 'g');

// Text from the input: control, line separator and direction characters replaced by a space, length capped.
export function safeText(value, max = 300) {
  const s = String(value).slice(0, max * 4).replace(UNSAFE_CHARACTERS, ' ');
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function meetsThreshold(severity, failOn) {
  return RANK[severity] <= RANK[failOn];
}

// The last part (and the last two parts) of an image name, in lower case, without registry, tag or digest; null for an
// image whose name is interpolated.
export function imageName(image) {
  if (typeof image !== 'string' || image.includes('$')) return null;
  let s = image.trim().toLowerCase().slice(0, 400);
  const at = s.indexOf('@');
  if (at >= 0) s = s.slice(0, at);
  const slash = s.lastIndexOf('/');
  const colon = s.lastIndexOf(':');
  if (colon > slash) s = s.slice(0, colon);
  const parts = s.split('/');
  return { last: parts.at(-1), lastTwo: parts.slice(-2).join('/') };
}

const matches = (list, image) => {
  const n = imageName(image);
  return n !== null && (list.includes(n.last) || list.includes(n.lastTwo));
};
export const isDatabaseImage = (image) => matches(DATABASE_IMAGES, image);
export const isBrokerImage = (image) => matches(BROKER_IMAGES, image);

// The logical database next to a host variable: for DB_HOST, the value of DB_NAME, DB_DATABASE or DB_DB.
function databaseNameNear(env, variable) {
  const upper = variable.toUpperCase();
  const ending = HOST_NAME_ENDINGS.find((e) => upper.endsWith(`_${e}`));
  if (!ending) return null;
  const prefix = variable.slice(0, variable.length - ending.length - 1);
  for (const end of DATABASE_NAME_ENDINGS) {
    for (const key of [`${prefix}_${end}`, `${prefix}_${end.toLowerCase()}`]) {
      const v = env.get(key);
      if (v && typeof v.value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(v.value.trim())) return v.value.trim();
    }
  }
  return null;
}

// ---- the run ----------------------------------------------------------------------------------------------------------

// options: maxChain, hubMin, databases (names given with --database).
export function runRules(model, limits = MODEL_LIMITS, options = {}) {
  const maxChain = options.maxChain ?? DEFAULT_MAX_CHAIN;
  const hubMin = options.hubMin ?? DEFAULT_HUB_MIN;
  const named = options.databases ?? [];
  const found = [];
  const facts = { services: 0, databases: 0, brokers: 0, applications: 0, references: 0, byKind: { depends_on: 0, links: 0, environment: 0 }, interpolated: 0, tooLong: 0, omitted: {}, unknownDatabases: [] };

  const basisOf = (keys) => keys.map((k) => ({ text: FACTS[k].text, section: FACTS[k].section, source: factPage(k) }));
  function add(id, place, subject, message, fix, basis = BY_ID[id].facts) {
    const def = BY_ID[id];
    const f = {
      id,
      severity: def.severity,
      area: def.area,
      file: safeText(place.file, 400),
      where: safeText(place.where, 400),
      line: place.line,
      subject: safeText(subject, 200),
      message: safeText(message, 900),
      fix: safeText(fix, 500),
      basis: basisOf(basis),
      source: factPage(basis[0])
    };
    found.push(f);
    return f;
  }
  const q = (name) => `"${safeText(name, 80)}"`;
  const listOf = (names, max = 10) => (names.length <= max ? names : [...names.slice(0, max - 1), `${names.length - max + 1} more`]);
  const join = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

  for (const p of model.problems) add('value-invalid', p.place, p.subject, p.message, p.fix);

  const services = [...model.services.values()].sort((a, b) => a.order - b.order);
  facts.services = services.length;

  // Names a service can be reached by: its name, container_name, hostname and network aliases (the name comes first).
  const byName = new Map();
  for (const s of services) byName.set(s.name.toLowerCase(), s);
  for (const s of services) {
    for (const n of [s.containerName?.value, s.hostName?.value, ...s.aliases.keys()]) {
      if (typeof n === 'string' && !byName.has(n.toLowerCase())) byName.set(n.toLowerCase(), s);
    }
  }
  const byIp = new Map();
  for (const s of services) for (const { ip } of s.ips) if (!byIp.has(ip.toLowerCase())) byIp.set(ip.toLowerCase(), s);

  // ---- the references between services ----
  // edges: from -> Map(to -> { depends: entry | null, links: [entry], env: [{ variable, place, database }] })
  const edges = new Map(services.map((s) => [s, new Map()]));
  let edgeCount = 0;
  const edgeOf = (from, to) => {
    const out = edges.get(from);
    let e = out.get(to);
    if (!e) {
      edgeCount += 1;
      if (edgeCount > limits.maxEdges) throw new Error(`more than ${limits.maxEdges.toLocaleString('en-US')} references between services`);
      e = { depends: null, links: [], env: [] };
      out.set(to, e);
    }
    return e;
  };
  const byAddress = new Set(); // services that another service reaches with a database address
  const unknownFix = model.includes.length ? ' The files include other Compose files that were not read; if the service is defined there, give that file as another argument.' : '';

  for (const s of services) {
    for (const [target, entry] of s.dependsOn) {
      const t = model.services.get(target);
      if (!t) {
        add('unknown-dependency', entry.place, s.name, `The service ${q(s.name)} depends on ${q(target)} in ${KEYS.dependsOn}, and no file defines a service of that name, so Compose cannot start ${q(s.name)}.${unknownFix}`,
          `Define the service ${q(target)}, correct the name, or remove the entry.`);
        continue;
      }
      edgeOf(s, t).depends = entry;
    }
    const linkAlias = new Map();
    for (const link of s.links.values()) {
      const t = model.services.get(link.target);
      if (!t) {
        add('unknown-dependency', link.place, s.name, `The service ${q(s.name)} links to ${q(link.target)} in ${KEYS.links}, and no file defines a service of that name.${unknownFix}`,
          `Define the service ${q(link.target)}, correct the name, or remove the link.`);
        continue;
      }
      edgeOf(s, t).links.push(link);
      if (link.alias) linkAlias.set(link.alias.toLowerCase(), t);
    }
    const fixed = new Map(); // variable -> { place, ips: [{ ip, service }] }
    for (const [variable, { value, place }] of s.env) {
      const a = addressesOf(variable, value);
      if (a === null) continue;
      if (a.tooLong) {
        facts.tooLong += 1;
        continue;
      }
      if (a.interpolated) {
        facts.interpolated += 1;
        continue;
      }
      for (const { host } of a.hosts) {
        if (isLocal(host)) continue;
        let t;
        if (isIP(host)) {
          t = byIp.get(host.toLowerCase());
          if (!fixed.has(variable)) fixed.set(variable, { place, ips: [] });
          const list = fixed.get(variable).ips;
          if (!list.some((x) => x.ip === host)) list.push({ ip: host, service: t ?? null });
        } else {
          t = linkAlias.get(host.toLowerCase()) ?? byName.get(host.toLowerCase());
        }
        if (!t || t === s) continue;
        let database = null;
        if (a.databaseScheme) {
          byAddress.add(t);
          database = a.database;
        } else if (a.scheme === null && isHostVariable(variable)) {
          database = databaseNameNear(s.env, variable);
        }
        const e = edgeOf(s, t);
        if (!e.env.some((x) => x.variable === variable)) e.env.push({ variable, place, database, databaseScheme: a.databaseScheme });
      }
    }
    for (const [variable, { place, ips }] of fixed) {
      const shown = ips.slice(0, 5).map(({ ip, service }) => (service ? `${safeText(ip, 60)} (the fixed address of ${q(service.name)})` : safeText(ip, 60)));
      add('hardcoded-peer-address', place, s.name, `The variable ${safeText(variable, 80)} of the service ${q(s.name)} reaches ${join(shown)} by IP address. An address written into the file breaks when the network or the other service moves, and hides the link between the services from anyone who reads the file.`,
        'Use the name of the service (or a network alias) as the host, and let the Compose network resolve it.');
    }
  }

  // ---- what kind of service each one is ----
  for (const n of named) if (!model.services.has(n)) facts.unknownDatabases.push(n);
  const kind = new Map();
  for (const s of services) {
    const image = s.image?.value;
    if (named.includes(s.name) || isDatabaseImage(image) || byAddress.has(s)) kind.set(s, 'database');
    else if (isBrokerImage(image)) kind.set(s, 'broker');
    else kind.set(s, 'application');
  }
  for (const k of kind.values()) facts[k === 'database' ? 'databases' : k === 'broker' ? 'brokers' : 'applications'] += 1;

  // fan-in and fan-out over every kind of reference, between different services.
  const fanIn = new Map(services.map((s) => [s, new Set()]));
  for (const [from, out] of edges) {
    for (const [to, e] of out) {
      if (from === to) continue;
      fanIn.get(to).add(from);
      facts.references += 1;
      if (e.depends) facts.byKind.depends_on += 1;
      if (e.links.length) facts.byKind.links += 1;
      if (e.env.length) facts.byKind.environment += 1;
    }
  }
  const fanOut = (s) => [...edges.get(s).keys()].filter((t) => t !== s).length;

  // ---- data ownership ----
  for (const d of services) {
    if (kind.get(d) !== 'database') continue;
    const users = [...fanIn.get(d)].filter((u) => kind.get(u) !== 'database').sort((a, b) => a.order - b.order);
    if (users.length < 2) continue;
    const how = [];
    const names = [];
    for (const u of users) {
      const e = edges.get(u).get(d);
      const ways = [];
      if (e.depends) ways.push(KEYS.dependsOn);
      if (e.links.length) ways.push(KEYS.links);
      for (const v of e.env) ways.push(safeText(v.variable, 60));
      how.push(`${q(u.name)} (${ways.join(', ')})`);
      names.push(new Set(e.env.map((v) => v.database).filter((x) => typeof x === 'string' && x !== '')));
    }
    const allNamed = names.every((n) => n.size > 0);
    const seen = new Set();
    let distinct = allNamed;
    for (const n of names) for (const x of n) {
      if (seen.has(x)) distinct = false;
      seen.add(x);
    }
    const place = d.place;
    const userList = join(listOf(how));
    if (distinct) {
      add('shared-database-server', place, d.name, `The services ${userList} reach the database server ${q(d.name)}, and each names a database of its own on it. One server for several services is allowed when each service can reach only its own database. The file cannot show the credentials or the grants that keep them apart.`,
        `Check that each service has its own credentials and that they grant access to its own database on ${q(d.name)} only.`);
    } else {
      const why = allNamed ? 'at least two of them name the same database on it' : 'the file does not show that each one uses a database of its own on it';
      add('shared-database', place, d.name, `The services ${userList} ${users.length === 2 ? 'both' : 'all'} reach the database service ${q(d.name)}, and ${why}. A change to one table can then break another service, and one service's load or locks can slow down the others.`,
        `Give each service its own database (a database server per service, or its own database or schema on ${q(d.name)} with credentials that reach only that one), and let the other services ask the owner through its API.`);
    }
  }

  // ---- startup order: loops, chains and health ----
  // The startup graph: depends_on and links between defined services.
  const startup = new Map(services.map((s) => [s, []]));
  for (const [from, out] of edges) for (const [to, e] of out) if (e.depends || e.links.length) startup.get(from).push(to);

  // Loops: the strongly connected components (Tarjan), walked with a list instead of recursion so that a long chain
  // cannot overflow the stack. A component of more than one service, or a service that names itself, is a loop.
  const index = new Map();
  const low = new Map();
  const comp = new Map();
  const onStack = new Set();
  const stack = [];
  let counter = 0;
  const loops = [];
  for (const start of services) {
    if (index.has(start)) continue;
    const work = [[start, 0]];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const top = work[work.length - 1];
      const [v, i] = top;
      const next = startup.get(v);
      if (i < next.length) {
        top[1] += 1;
        const w = next[i];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter += 1;
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
      if (low.get(v) === index.get(v)) {
        const component = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          component.push(w);
          comp.set(w, v);
        } while (w !== v);
        if (component.length > 1 || startup.get(v).includes(v)) loops.push(component.sort((x, y) => x.order - y.order));
      }
    }
  }
  for (const loop of loops) {
    const first = loop[0];
    const inLoop = new Set(loop);
    const step = startup.get(first).find((t) => inLoop.has(t));
    const e = edges.get(first).get(step);
    const place = e.depends ? e.depends.place : e.links[0].place;
    const names = loop.map((x) => q(x.name));
    const list = loop.length === 1 ? `The service ${names[0]} names itself in ${e.depends ? KEYS.dependsOn : KEYS.links}` : `The services ${join(listOf(names))} depend on each other in a loop through ${KEYS.dependsOn} and ${KEYS.links}`;
    add('dependency-cycle', place, first.name, `${list}, so there is no order in which Compose can create them, or remove them.`,
      'Remove the link that is not needed at startup. If the services truly need each other, they are one unit: merge them, or let one find the other at run time and retry instead of waiting for it at startup.');
  }

  // Chains: the longest path of the startup graph without the links inside a loop (what is left has no loop). The depth
  // of a service is the number of steps of its longest chain; it is computed with a list instead of recursion.
  const reduced = new Map(services.map((s) => [s, startup.get(s).filter((t) => comp.get(t) !== comp.get(s))]));
  const depth = new Map();
  const nextOf = new Map();
  for (const start of services) {
    if (depth.has(start)) continue;
    const work = [start];
    const entered = new Set();
    while (work.length) {
      const v = work[work.length - 1];
      if (depth.has(v)) {
        work.pop();
        continue;
      }
      if (!entered.has(v)) {
        entered.add(v);
        for (const w of reduced.get(v)) if (!depth.has(w)) work.push(w);
        continue;
      }
      let best = 0;
      let bestNext = null;
      for (const w of reduced.get(v)) {
        const d = depth.get(w) + 1;
        if (d > best) {
          best = d;
          bestNext = w;
        }
      }
      depth.set(v, best);
      nextOf.set(v, bestNext);
      work.pop();
    }
  }
  const hasParent = new Set();
  for (const s of services) for (const t of reduced.get(s)) hasParent.add(t);
  for (const s of services) {
    if (hasParent.has(s) || depth.get(s) <= maxChain) continue;
    const chain = [s];
    while (nextOf.get(chain.at(-1))) chain.push(nextOf.get(chain.at(-1)));
    const shown = chain.length > 12 ? [...chain.slice(0, 11).map((x) => x.name), '...', chain.at(-1).name] : chain.map((x) => x.name);
    const e = edges.get(s).get(chain[1]);
    const place = e.depends ? e.depends.place : e.links[0].place;
    add('deep-startup-chain', place, s.name, `The service ${q(s.name)} starts only after a chain of ${depth.get(s)} services: ${shown.map((n) => safeText(n, 60)).join(' -> ')}. The limit is ${maxChain}. Each step waits for the one below it, so a slow or failing service at the end holds up every service above it.`,
      'Remove the depends_on entries that are not needed at startup, and let a service retry a peer at run time instead of waiting for it. Raise the limit with --max-chain only if the chain is wanted.');
  }

  for (const s of services) {
    for (const [target, entry] of s.dependsOn) {
      const t = model.services.get(target);
      if (!t || t === s || entry.condition !== CONDITIONS.started) continue;
      if (t.healthcheck.state !== 'declared' && t.healthcheck.state !== 'partial') continue;
      add('depends-on-not-healthy', entry.place, s.name, `The service ${q(s.name)} depends on ${q(t.name)} ${entry.syntax === 'short' ? 'with the short syntax' : `with the condition ${CONDITIONS.started}`}, so Compose starts it as soon as the container of ${q(t.name)} has started, not when it is healthy, although ${q(t.name)} has a healthcheck.`,
        `Write the long syntax with "condition: ${CONDITIONS.healthy}" for ${q(t.name)}.`);
    }
  }
  for (const t of services) {
    if (t.healthcheck.state === 'declared' || t.healthcheck.state === 'partial') continue;
    const dependents = services.filter((s) => s !== t && s.dependsOn.has(t.name) && s.dependsOn.get(t.name).condition !== CONDITIONS.completed);
    if (!dependents.length) continue;
    const waiting = dependents.filter((s) => s.dependsOn.get(t.name).condition === CONDITIONS.healthy);
    const state = t.healthcheck.state === 'disabled' ? 'disables its healthcheck' : 'declares no healthcheck';
    const extra = waiting.length ? ` ${join(listOf(waiting.map((s) => q(s.name))))} ${waiting.length === 1 ? 'waits' : 'wait'} for it with ${CONDITIONS.healthy}, which Compose can only meet if the image defines a healthcheck.` : '';
    add('no-healthcheck', t.healthcheck.state === 'disabled' ? t.healthcheck.place : t.place, t.name, `${dependents.length === 1 ? 'The service' : 'The services'} ${join(listOf(dependents.map((s) => q(s.name))))} ${dependents.length === 1 ? 'depends' : 'depend'} on ${q(t.name)}, which ${state} in the file, so nothing tells ${dependents.length === 1 ? 'it' : 'them'} when ${q(t.name)} is ready to answer.${extra} The image may define a healthcheck that the file does not show.`,
      `Add a healthcheck to ${q(t.name)} that tests what its dependents need (for example that it answers on its port), and make them wait with "condition: ${CONDITIONS.healthy}".`);
  }

  // ---- coupling ----
  const apps = services.filter((s) => kind.get(s) === 'application');
  for (const s of apps) {
    const from = [...fanIn.get(s)].filter((u) => kind.get(u) === 'application').sort((a, b) => a.order - b.order);
    const others = apps.length - 1;
    if (from.length < hubMin || from.length * 2 <= others) continue;
    add('hub-service', s.place, s.name, `${from.length} of the ${others} other application services reach ${q(s.name)}: ${join(listOf(from.map((u) => q(u.name))))}. A change to its API, a slow answer or an outage of ${q(s.name)} reaches most of the application at once, and it cannot be changed or replaced on its own.`,
      `Check whether every service needs ${q(s.name)} directly. Callers can get its data from events they keep a copy of, or through the gateway; split ${q(s.name)} if it does more than one job.`);
  }

  if (services.length) {
    const ranked = [...services].sort((a, b) => fanIn.get(b).size - fanIn.get(a).size || a.order - b.order);
    const outRanked = [...services].sort((a, b) => fanOut(b) - fanOut(a) || a.order - b.order);
    const top = ranked[0];
    const topOut = outRanked[0];
    const firstFile = model.files.find((f) => f.services > 0) ?? model.files[0];
    const place = { file: firstFile.path, where: `#/${KEYS.services}`, line: firstFile.servicesLine };
    add('summary', place, KEYS.services, `${facts.services} ${facts.services === 1 ? 'service' : 'services'} (${facts.applications} application, ${facts.databases} database, ${facts.brokers} broker) with ${facts.references} ${facts.references === 1 ? 'reference' : 'references'} between them (${facts.byKind.depends_on} by ${KEYS.dependsOn}, ${facts.byKind.links} by ${KEYS.links}, ${facts.byKind.environment} by ${KEYS.environment}). The highest fan-in is ${q(top.name)} (${fanIn.get(top).size}) and the highest fan-out is ${q(topOut.name)} (${fanOut(topOut)}).`,
      'Nothing to fix; this line and the services table show the shape of the application.');
  }

  const table = services.map((s) => ({
    name: safeText(s.name, 120),
    kind: kind.get(s),
    fanIn: fanIn.get(s).size,
    fanOut: fanOut(s),
    healthcheck: s.healthcheck.state === 'declared' ? 'yes' : s.healthcheck.state === 'partial' ? 'partial' : s.healthcheck.state === 'disabled' ? 'disabled' : 'no',
    chain: depth.get(s) ?? 0
  }));

  // Sorted, and each finding id listed at most maxListedPerFinding times; the rest is counted in omitted.
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const fileOrder = new Map(model.files.map((f, i) => [f.path, i]));
  found.sort((a, b) => RANK[a.severity] - RANK[b.severity] || AREA_ORDER[a.area] - AREA_ORDER[b.area] || ORDER[a.id] - ORDER[b.id] || (fileOrder.get(a.file) ?? 0) - (fileOrder.get(b.file) ?? 0) || a.line - b.line || compare(a.where, b.where) || compare(a.subject, b.subject));
  const shownPerId = {};
  const findings = [];
  for (const f of found) {
    shownPerId[f.id] = (shownPerId[f.id] ?? 0) + 1;
    if (shownPerId[f.id] <= limits.maxListedPerFinding) findings.push(f);
    else facts.omitted[f.id] = (facts.omitted[f.id] ?? 0) + 1;
  }
  return { findings, facts, table };
}
