// Command line: service-coupling-check <compose-file>... [options]

import { readFileSync } from 'node:fs';
import { FINDINGS, LIMITS, checkFiles, safeText } from './check.js';
import { toText, toMarkdown, toJson, toCsv } from './report.js';
import { DEFAULT_HUB_MIN, DEFAULT_MAX_CHAIN, MAX_OPTION } from './rules.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FORMATS = { text: toText, markdown: toMarkdown, json: toJson, csv: toCsv };
const THRESHOLDS = ['error', 'warning'];

export const USAGE = `Usage: service-coupling-check <compose-file>... [options]

Reads one or more Docker Compose files (YAML or JSON, merged in the order given) and reports how tightly the services
are coupled, as far as the files show it: services that share one database, loops and long chains in depends_on and
links, depends_on that does not wait for a healthcheck, services that others depend on with no healthcheck, one service
that most others reach, peers reached by a fixed IP address, and names that no file defines. It never prints the value
of an environment variable (only its name, and a fixed IP address), opens no network connection and runs no program.

Options:
  --format <name>          text, markdown, json or csv (default: text)
  --fail-on <level>        exit with 1 when a finding is at this level or above: error or warning
                           (default: error); info never fails the run
  --max-chain <n>          the longest chain of depends_on and links allowed (default: ${DEFAULT_MAX_CHAIN})
  --hub-min <n>            the fewest application services that must reach one service before it is a hub
                           (default: ${DEFAULT_HUB_MIN})
  --database <service>     read this service as a database; may be given more than once
  --help                   show this text
  --version                show the version

Checks: ${FINDINGS.map((f) => f.id).join(', ')}

Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
`;

const whole = (flag, v, min) => {
  if (!/^[0-9]{1,6}$/.test(v) || Number(v) < min || Number(v) > MAX_OPTION) throw new Error(`${flag} takes a whole number from ${min} to ${MAX_OPTION}, not ${v.slice(0, 20)}`);
  return Number(v);
};

export function parseArgs(argv) {
  const o = { files: [], format: 'text', failOn: 'error', maxChain: DEFAULT_MAX_CHAIN, hubMin: DEFAULT_HUB_MIN, databases: [], help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--format') o.format = next();
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '--max-chain') o.maxChain = whole(a, next(), 1);
    else if (a === '--hub-min') o.hubMin = whole(a, next(), 2);
    else if (a === '--database') {
      const v = next();
      if (v.trim() === '' || v.length > 200) throw new Error('--database takes the name of a service');
      if (o.databases.length >= 100) throw new Error('--database is given more than 100 times');
      o.databases.push(v);
    } else if (a === '-') throw new Error('reading from standard input is not supported; give the path of the file');
    else if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
    else if (o.files.includes(a)) throw new Error(`the file ${a} is given twice`);
    else if (o.files.length >= LIMITS.maxFiles) throw new Error(`give at most ${LIMITS.maxFiles} files`);
    else o.files.push(a);
  }
  if (!o.help && !o.version) {
    if (o.files.length === 0) throw new Error('give the path of a Compose file');
    for (const f of o.files) if (/^[a-z][a-z0-9+.-]*:\/\//i.test(f)) throw new Error('give a local path; the tool never fetches a URL');
    if (!Object.hasOwn(FORMATS, o.format)) throw new Error(`unknown format ${o.format} (text, markdown, json or csv)`);
    if (!THRESHOLDS.includes(o.failOn)) throw new Error(`--fail-on takes error or warning, not ${o.failOn}`);
  }
  return o;
}

function clean(text) {
  return safeText(text, 1500);
}

// Exit code: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, limits = LIMITS, base = process.cwd()) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`service-coupling-check: ${clean(error.message)}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  let report;
  try {
    report = await checkFiles(o.files, { failOn: o.failOn, version: VERSION, limits, base, maxChain: o.maxChain, hubMin: o.hubMin, databases: o.databases });
  } catch (error) {
    io.err(`service-coupling-check: ${clean(error.message)}\n`);
    return 2;
  }
  io.out(FORMATS[o.format](report));
  return report.gate.pass ? 0 : 1;
}
