// Reads one or more Compose files, runs the checks of src/rules.js and returns one report: the services table, the
// findings grouped by area, notes and the gate. docs/method.md gives the reason behind every finding. The tool reads the
// files it is given and opens no connection.

import { resolve } from 'node:path';
import { KEYS } from './data.js';
import { FILE_LIMITS, displayPath, readBounded } from './files.js';
import { MODEL_LIMITS, readCompose } from './compose.js';
import { AREAS, BY_ID_SEVERITY, DEFAULT_HUB_MIN, DEFAULT_MAX_CHAIN, FINDINGS, ORDER, RANK, SEVERITIES, meetsThreshold, runRules, safeText } from './rules.js';

export const LIMITS = { ...MODEL_LIMITS, ...FILE_LIMITS };
export { AREAS, FINDINGS, ORDER, RANK, SEVERITIES, meetsThreshold, safeText };

function plural(count, one, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

const names = (list, max = 10) => {
  const shown = list.slice(0, max).map((n) => `"${safeText(n, 80)}"`);
  if (list.length > max) return `${shown.join(', ')} and ${list.length - max} more`;
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
};

// Builds the report for the texts of the files. files is a list of { text, name, path }: name chooses YAML or JSON,
// path is shown in the report.
export function checkTexts(files, { failOn = 'error', version = '0.0.0', limits = LIMITS, maxChain = DEFAULT_MAX_CHAIN, hubMin = DEFAULT_HUB_MIN, databases = [] } = {}) {
  const model = readCompose(files, limits);
  const { findings, facts, table } = runRules(model, limits, { maxChain, hubMin, databases });

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  for (const [id, n] of Object.entries(facts.omitted)) counts[BY_ID_SEVERITY[id]] += n;

  const areas = AREAS.map((a) => {
    const own = findings.filter((f) => f.area === a.id);
    const worst = own.length ? own.reduce((w, f) => (RANK[f.severity] < RANK[w] ? f.severity : w), 'info') : null;
    const result = worst === 'error' ? 'fail' : worst === 'warning' ? 'warn' : worst === 'info' ? 'info' : 'pass';
    const detail = own.length ? [...new Set(own.map((f) => f.id))].map((id) => `${id} x${own.filter((f) => f.id === id).length}`).join(', ') : 'no finding';
    return { id: a.id, title: a.title, result, detail: safeText(detail, 400), findings: own.length };
  });

  const services = [...model.services.values()].sort((a, b) => a.order - b.order);
  const notes = [];
  if (services.length === 0) notes.push('The files define no service, so there was nothing to check');
  for (const inc of model.includes) {
    const shown = inc.paths.length ? `: ${inc.paths.slice(0, 5).map((p) => safeText(p, 120)).join(', ')}${inc.paths.length > 5 ? ', ...' : ''}` : '';
    notes.push(`${safeText(inc.file, 300)} has an ${KEYS.include} section (line ${inc.place.line}) that was not followed${shown}. Compose loads each included file as a model of its own; services defined there are not seen unless the file is given as another argument`);
  }
  const extended = services.filter((s) => s.extends);
  if (extended.length) notes.push(`${extended.length === 1 ? 'The service' : 'The services'} ${names(extended.map((s) => s.name))} ${extended.length === 1 ? 'uses' : 'use'} ${KEYS.extends}, which was not followed; what ${extended.length === 1 ? 'it inherits' : 'they inherit'} (${KEYS.dependsOn}, ${KEYS.links}, ${KEYS.environment}, ${KEYS.healthcheck}) is not seen`);
  const envFiles = services.filter((s) => s.envFile);
  if (envFiles.length) notes.push(`${envFiles.length === 1 ? 'The service' : 'The services'} ${names(envFiles.map((s) => s.name))} ${envFiles.length === 1 ? 'reads' : 'read'} variables from ${KEYS.envFile}, which was not read; an address written there is not seen`);
  const external = services.filter((s) => s.externalLinks);
  if (external.length) notes.push(`${external.length === 1 ? 'The service' : 'The services'} ${names(external.map((s) => s.name))} ${external.length === 1 ? 'has' : 'have'} ${KEYS.externalLinks} to containers outside these files, which were not checked`);
  const merged = services.filter((s) => s.files.length > 1);
  if (merged.length) notes.push(`${merged.length === 1 ? 'The service' : 'The services'} ${names(merged.map((s) => s.name))} ${merged.length === 1 ? 'is' : 'are'} defined in more than one file and ${merged.length === 1 ? 'was' : 'were'} merged in the order of the arguments (docs/inputs.md)`);
  if (facts.interpolated) notes.push(`${plural(facts.interpolated, 'environment value')} ${facts.interpolated === 1 ? 'writes its host' : 'write their host'} with \${...}, which the tool does not resolve, so ${facts.interpolated === 1 ? 'it was' : 'they were'} not read for addresses`);
  if (facts.tooLong) notes.push(`${plural(facts.tooLong, 'environment value')} longer than 4,096 characters ${facts.tooLong === 1 ? 'was' : 'were'} not read for addresses`);
  if (facts.unknownDatabases.length) notes.push(`--database names ${names(facts.unknownDatabases)}, which ${facts.unknownDatabases.length === 1 ? 'is not a service' : 'are not services'} in these files`);
  if (services.length > 1 && facts.databases === 0) notes.push('No service was read as a database (by its image, by a database address that reaches it, or by --database), so shared-database had nothing to look at');
  for (const [id, n] of Object.entries(facts.omitted)) notes.push(`${plural(n, 'more finding')} of ${id} ${n === 1 ? 'is' : 'are'} counted but not listed (the limit is ${limits.maxListedPerFinding} listed findings per check)`);

  const eCount = meetsThreshold('error', failOn) ? counts.error : 0;
  const wCount = meetsThreshold('warning', failOn) ? counts.warning : 0;
  const reason = [eCount ? plural(eCount, 'error') : null, wCount ? plural(wCount, 'warning') : null].filter(Boolean).join(', ');

  return {
    tool: 'service-coupling-check',
    version,
    compose: {
      files: model.files.map((f) => ({ path: safeText(f.path, 400), format: f.format, services: f.services })),
      services: facts.services,
      applications: facts.applications,
      databases: facts.databases,
      brokers: facts.brokers,
      references: facts.references,
      byKind: facts.byKind,
      maxChain,
      hubMin
    },
    areas,
    services: table,
    findings,
    notes,
    counts,
    gate: { failOn, pass: eCount + wCount === 0, reason }
  };
}

// The report for the text of one file. name chooses YAML or JSON and is the path shown.
export function checkText(text, name, options = {}) {
  return checkTexts([{ text, name, path: options.path ?? name }], options);
}

// Reads the files and builds the report. The paths in the report are relative to base, with forward slashes.
export async function checkFiles(paths, { failOn = 'error', version = '0.0.0', limits = LIMITS, base = process.cwd(), maxChain, hubMin, databases } = {}) {
  const files = [];
  for (const file of paths) {
    const full = resolve(base, file);
    const shown = displayPath(full, base);
    let text;
    try {
      text = (await readBounded(full, limits.maxFileBytes)).toString('utf8');
    } catch (error) {
      throw new Error(`${shown}: ${error.reason ?? error.message}`);
    }
    files.push({ text, name: full, path: shown });
  }
  return checkTexts(files, { failOn, version, limits, maxChain, hubMin, databases });
}
