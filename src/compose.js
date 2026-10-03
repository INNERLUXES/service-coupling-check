// Reading one or more Compose files (YAML or JSON) into one model: the services, and for each one what the coupling
// checks need (depends_on, links, environment, healthcheck, image and the names it can be reached by), with the file,
// the JSON pointer and the line of every value. Several files are merged in the order given, as docs/method.md says.
// Nothing here judges the coupling; src/rules.js does that. A value in a shape the tool cannot read is kept as a problem
// (reported as value-invalid), never guessed.

import { extname } from 'node:path';
import { CONDITIONS, HEALTHCHECK_NONE, KEYS } from './data.js';
import { parseJson } from './json.js';
import { YAML_LIMITS, parseYaml } from './yaml.js';

export const MODEL_LIMITS = {
  maxFiles: 50,
  maxNesting: 64,
  maxNodes: 500_000,
  maxServices: 5000,
  maxDependsPerService: 1000,
  maxEnvPerService: 5000,
  maxEdges: 200_000,
  maxListedPerFinding: 200
};

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A JSON pointer token written for a URI fragment: "~" becomes "~0" and "/" becomes "~1".
export function escapeToken(t) {
  return String(t).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function pointerOf(tokens) {
  return tokens.length === 0 ? '#' : `#/${tokens.map(escapeToken).join('/')}`;
}

// The line of a pointer, or of its nearest ancestor that has one.
export function lineOf(lines, pointer) {
  let p = pointer;
  for (;;) {
    const line = lines.get(p);
    if (line !== undefined) return line;
    const cut = p.lastIndexOf('/');
    if (cut <= 1) return lines.get('#') ?? 1;
    p = p.slice(0, cut);
  }
}

// The reader's nodes as plain data (objects without a prototype, so a key such as __proto__ is only a name), and a map
// from the pointer of every value to its line.
function toData(node, pointer, lines) {
  lines.set(pointer, node.line);
  if (node.t === 'object') {
    const out = Object.create(null);
    for (const p of node.props) {
      const child = `${pointer === '#' ? '#/' : `${pointer}/`}${escapeToken(p.key)}`;
      out[p.key] = toData(p.value, child, lines);
      lines.set(child, p.line);
    }
    return out;
  }
  if (node.t === 'array') return node.items.map((item, i) => toData(item, `${pointer === '#' ? '#/' : `${pointer}/`}${i}`, lines));
  return node.value;
}

// The format of a file from its name, or from its first character when the name does not say.
export function formatOf(text, name = '') {
  const ext = extname(name).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  const start = String(text).replace(BOM, '').slice(0, 1024).trimStart();
  return start.startsWith('{') ? 'json' : 'yaml';
}

// Parses the text of one file into { format, data, lines }.
export function parseFile(text, name, limits = MODEL_LIMITS) {
  const format = formatOf(text, name);
  const node = format === 'json'
    ? parseJson(text, 'the JSON', { limits: { maxDepth: limits.maxNesting, maxNodes: limits.maxNodes } })
    : parseYaml(text, 'the YAML', { ...YAML_LIMITS, maxDepth: limits.maxNesting, maxNodes: limits.maxNodes });
  const lines = new Map();
  return { format, data: toData(node, '#', lines), lines };
}

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const isText = (v) => typeof v === 'string';
const scalarText = (v) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);

// A new, empty service.
function newService(name, order, place) {
  return {
    name,
    order,
    place,
    files: [place.file],
    image: null,
    containerName: null,
    hostName: null,
    aliases: new Map(), // alias -> place
    ips: [], // { ip, place }
    dependsOn: new Map(), // target -> { condition, place, syntax }
    links: new Map(), // target:alias text -> { target, alias, place }
    env: new Map(), // name -> { value, place }
    healthcheck: { state: 'absent', place },
    extends: null,
    envFile: false,
    externalLinks: false
  };
}

// Reads the files, in order, into one model. Each file is { text, name, path }: name decides the format, path is the
// path shown in the report.
export function readCompose(files, limits = MODEL_LIMITS) {
  if (files.length > limits.maxFiles) throw new Error(`more than ${limits.maxFiles} files`);
  const services = new Map();
  const problems = []; // { place, subject, message, fix, facts }
  const fileInfo = [];
  const includes = []; // { file, place, paths }
  let order = 0;

  for (const f of files) {
    let parsed;
    try {
      parsed = parseFile(f.text, f.name, limits);
    } catch (error) {
      throw new Error(`${f.path}: ${error.message}`);
    }
    const { data, lines, format } = parsed;
    const at = (tokens) => {
      const where = pointerOf(tokens);
      return { file: f.path, where, line: lineOf(lines, where) };
    };
    if (!isObj(data)) throw new Error(`${f.path}: not a Compose file: the file does not hold a mapping of top-level keys`);
    const info = { path: f.path, format, services: 0, servicesLine: lineOf(lines, pointerOf([KEYS.services])) };
    fileInfo.push(info);

    if (data[KEYS.include] !== undefined && data[KEYS.include] !== null) {
      const inc = data[KEYS.include];
      const paths = [];
      if (Array.isArray(inc)) {
        for (const item of inc) {
          if (isText(item)) paths.push(item);
          else if (isObj(item) && isText(item.path)) paths.push(item.path);
          else if (isObj(item) && Array.isArray(item.path)) paths.push(...item.path.filter(isText));
        }
      }
      includes.push({ file: f.path, place: at([KEYS.include]), count: Array.isArray(inc) ? inc.length : 1, paths });
    }

    const list = data[KEYS.services];
    if (list === undefined || list === null) {
      if (data[KEYS.include] === undefined) throw new Error(`${f.path}: not a Compose file: there is no "${KEYS.services}" mapping`);
      continue;
    }
    if (!isObj(list)) throw new Error(`${f.path}: not a Compose file: "${KEYS.services}" is not a mapping of service names`);
    const names = Object.keys(list);
    info.services = names.length;

    for (const name of names) {
      const def = list[name];
      const base = [KEYS.services, name];
      const svcPlace = at(base);
      let svc = services.get(name);
      if (!svc) {
        if (services.size >= limits.maxServices) throw new Error(`${f.path}: more than ${limits.maxServices.toLocaleString('en-US')} services`);
        svc = newService(name, order, svcPlace);
        order += 1;
        services.set(name, svc);
      } else if (!svc.files.includes(f.path)) {
        svc.files.push(f.path);
      }
      const bad = (tokens, what, expected) => problems.push({ place: at(tokens), subject: name, message: `${what} of the service "${name}" is not ${expected}, so it was not read.`, fix: `Write ${expected}.` });
      if (def === null) continue; // an empty service definition: nothing to read
      if (!isObj(def)) {
        bad(base, 'The definition', 'a mapping of keys');
        continue;
      }

      // image, container_name, hostname: the last file wins.
      for (const [key, field] of [[KEYS.image, 'image'], [KEYS.containerName, 'containerName'], [KEYS.hostname, 'hostName']]) {
        if (def[key] === undefined || def[key] === null) continue;
        if (!isText(def[key])) bad([...base, key], `The ${key}`, 'a text');
        else svc[field] = { value: def[key], place: at([...base, key]) };
      }

      // depends_on: a list of names (short syntax) or a mapping of names to { condition, required, restart }.
      const dep = def[KEYS.dependsOn];
      if (dep !== undefined && dep !== null) {
        const entries = [];
        if (Array.isArray(dep)) {
          dep.forEach((d, i) => {
            if (!isText(d) || d.trim() === '') bad([...base, KEYS.dependsOn, String(i)], `An entry of ${KEYS.dependsOn}`, 'a service name');
            else entries.push({ target: d.trim(), condition: CONDITIONS.started, place: at([...base, KEYS.dependsOn, String(i)]), syntax: 'short' });
          });
        } else if (isObj(dep)) {
          for (const target of Object.keys(dep)) {
            const opts = dep[target];
            const place = at([...base, KEYS.dependsOn, target]);
            if (opts !== null && !isObj(opts)) {
              bad([...base, KEYS.dependsOn, target], `The entry "${target}" of ${KEYS.dependsOn}`, 'a mapping with condition, required or restart');
              continue;
            }
            let condition = CONDITIONS.started;
            if (opts !== null && opts[KEYS.condition] !== undefined && opts[KEYS.condition] !== null) {
              const c = opts[KEYS.condition];
              if (!isText(c) || !Object.values(CONDITIONS).includes(c)) {
                bad([...base, KEYS.dependsOn, target, KEYS.condition], `The condition of "${target}" in ${KEYS.dependsOn}`, `one of ${Object.values(CONDITIONS).join(', ')}`);
                continue;
              }
              condition = c;
            }
            entries.push({ target, condition, place, syntax: 'long' });
          }
        } else {
          bad([...base, KEYS.dependsOn], `The ${KEYS.dependsOn}`, 'a list of service names or a mapping of service names');
        }
        // Merged by service name: a later file sets the condition (docs/method.md).
        for (const e of entries) svc.dependsOn.set(e.target, e);
        if (svc.dependsOn.size > limits.maxDependsPerService) throw new Error(`${svcPlace.file}: ${svcPlace.where}: more than ${limits.maxDependsPerService.toLocaleString('en-US')} entries in ${KEYS.dependsOn}`);
      }

      // links: "service" or "service:alias". A list; later files append.
      const links = def[KEYS.links];
      if (links !== undefined && links !== null) {
        if (!Array.isArray(links)) bad([...base, KEYS.links], `The ${KEYS.links}`, 'a list of service names');
        else {
          links.forEach((l, i) => {
            if (!isText(l) || l.trim() === '') {
              bad([...base, KEYS.links, String(i)], `An entry of ${KEYS.links}`, 'a service name, or a service name and an alias');
              return;
            }
            const [target, alias] = l.trim().split(':', 2);
            if (!svc.links.has(l.trim())) svc.links.set(l.trim(), { target, alias: alias ?? null, place: at([...base, KEYS.links, String(i)]) });
          });
          if (svc.links.size > limits.maxDependsPerService) throw new Error(`${svcPlace.file}: ${svcPlace.where}: more than ${limits.maxDependsPerService.toLocaleString('en-US')} entries in ${KEYS.links}`);
        }
      }

      // environment: a mapping or a list of NAME=value. Merged by variable name; a later file wins.
      const env = def[KEYS.environment];
      if (env !== undefined && env !== null) {
        if (isObj(env)) {
          for (const key of Object.keys(env)) {
            const v = env[key];
            if (v !== null && scalarText(v) === null) bad([...base, KEYS.environment, key], `The variable ${key} in ${KEYS.environment}`, 'a text, a number, a boolean or empty');
            else svc.env.set(key, { value: v === null ? null : scalarText(v), place: at([...base, KEYS.environment, key]) });
          }
        } else if (Array.isArray(env)) {
          env.forEach((item, i) => {
            if (!isText(item)) {
              bad([...base, KEYS.environment, String(i)], `An entry of ${KEYS.environment}`, 'a text NAME=value');
              return;
            }
            const eq = item.indexOf('=');
            const key = eq < 0 ? item : item.slice(0, eq);
            svc.env.set(key, { value: eq < 0 ? null : item.slice(eq + 1), place: at([...base, KEYS.environment, String(i)]) });
          });
        } else {
          bad([...base, KEYS.environment], `The ${KEYS.environment}`, 'a mapping or a list of NAME=value');
        }
        if (svc.env.size > limits.maxEnvPerService) throw new Error(`${svcPlace.file}: ${svcPlace.where}: more than ${limits.maxEnvPerService.toLocaleString('en-US')} variables in ${KEYS.environment}`);
      }

      // healthcheck: declared (a test), partial (settings only; the test comes from the image), or disabled.
      const hc = def[KEYS.healthcheck];
      if (hc !== undefined && hc !== null) {
        const place = at([...base, KEYS.healthcheck]);
        if (!isObj(hc)) bad([...base, KEYS.healthcheck], `The ${KEYS.healthcheck}`, 'a mapping');
        else {
          const test = hc[KEYS.test];
          let state = svc.healthcheck.state === 'declared' || svc.healthcheck.state === 'disabled' ? svc.healthcheck.state : 'partial';
          if (test !== undefined && test !== null) {
            if (isText(test)) state = test.trim() === '' ? 'disabled' : 'declared';
            else if (Array.isArray(test)) state = test.length === 0 || test[0] === HEALTHCHECK_NONE ? 'disabled' : 'declared';
            else bad([...base, KEYS.healthcheck, KEYS.test], `The ${KEYS.healthcheck} ${KEYS.test}`, 'a text or a list');
          }
          if (hc[KEYS.disable] === true) state = 'disabled';
          svc.healthcheck = { state, place };
        }
      }

      // The names and addresses the service can be reached by: network aliases and fixed addresses.
      const nets = def[KEYS.networks];
      if (isObj(nets)) {
        for (const net of Object.keys(nets)) {
          const n = nets[net];
          if (!isObj(n)) continue;
          if (Array.isArray(n[KEYS.aliases])) n[KEYS.aliases].forEach((a, i) => { if (isText(a)) svc.aliases.set(a, at([...base, KEYS.networks, net, KEYS.aliases, String(i)])); });
          for (const key of [KEYS.ipv4, KEYS.ipv6]) if (isText(n[key])) svc.ips.push({ ip: n[key], place: at([...base, KEYS.networks, net, key]) });
        }
      }

      if (def[KEYS.extends] !== undefined && def[KEYS.extends] !== null) {
        const e = def[KEYS.extends];
        svc.extends = { service: isText(e) ? e : isObj(e) && isText(e.service) ? e.service : null, file: isObj(e) && isText(e.file) ? e.file : null, place: at([...base, KEYS.extends]) };
      }
      if (def[KEYS.envFile] !== undefined && def[KEYS.envFile] !== null) svc.envFile = true;
      if (def[KEYS.externalLinks] !== undefined && def[KEYS.externalLinks] !== null) svc.externalLinks = true;
    }
  }
  return { files: fileInfo, services, problems, includes };
}
