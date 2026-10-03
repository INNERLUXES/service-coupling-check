// Report formats: text for a terminal, Markdown for a pull request or job summary, JSON for other tools, CSV for a
// spreadsheet. Findings are grouped by area, and each one quotes the sentence of the specification or the pattern page
// that it rests on.

import { AREAS } from './rules.js';

function plural(count, one, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

function countsLine(c) {
  return `${c.error} error, ${c.warning} warning, ${c.info} info`;
}

function gateLine(r) {
  return r.gate.pass ? `GATE: PASS (--fail-on ${r.gate.failOn})` : `GATE: FAIL - ${r.gate.reason}`;
}

// The findings of one area, for the areas that have any.
function groups(r) {
  const out = [];
  for (const a of AREAS) {
    const own = r.findings.filter((f) => f.area === a.id);
    if (own.length) out.push({ title: a.title, findings: own });
  }
  return out;
}

function composeLine(r) {
  const c = r.compose;
  const k = c.byKind;
  return `compose: ${plural(c.files.length, 'file')}, ${plural(c.services, 'service')} (${c.applications} application, ${c.databases} database, ${c.brokers} broker), ${plural(c.references, 'reference')} (${k.depends_on} depends_on, ${k.links} links, ${k.environment} environment), chain limit ${c.maxChain}, hub minimum ${c.hubMin}`;
}

const filesOf = (r) => r.compose.files.map((f) => f.path).join(', ');

function where(f) {
  return `${f.file} ${f.where}`;
}

export function toText(r) {
  const lines = [`service-coupling-check: ${filesOf(r)}`, composeLine(r), 'areas:'];
  for (const a of r.areas) lines.push(`  ${a.title.padEnd(16)}  ${a.result.padEnd(5)}  ${a.detail}`);
  if (r.services.length) {
    const width = Math.min(30, Math.max(7, ...r.services.map((s) => s.name.length)));
    lines.push('services:');
    lines.push(`  ${'service'.padEnd(width)}  ${'kind'.padEnd(11)}  fan-in  fan-out  chain  healthcheck`);
    for (const s of r.services) lines.push(`  ${s.name.padEnd(width)}  ${s.kind.padEnd(11)}  ${String(s.fanIn).padStart(6)}  ${String(s.fanOut).padStart(7)}  ${String(s.chain).padStart(5)}  ${s.healthcheck}`);
  }
  lines.push(`findings: ${countsLine(r.counts)}`);
  if (!r.findings.length) lines.push('', 'no findings');
  for (const g of groups(r)) {
    lines.push('', `${g.title} (${plural(g.findings.length, 'finding')})`);
    for (const f of g.findings) {
      lines.push('', `  ${f.severity.toUpperCase().padEnd(7)}  ${f.id}  ${where(f)}  line ${f.line}`);
      lines.push(`           ${f.message}`);
      for (const b of f.basis) lines.push(`           basis: "${b.text}" (${b.section}, ${b.source})`);
      lines.push(`           fix: ${f.fix}`);
    }
  }
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`note: ${note}`);
  lines.push('', gateLine(r));
  return lines.join('\n') + '\n';
}

// A Markdown table cell: backslashes, pipes, square brackets and backticks escaped, line breaks flattened, and <, > and &
// written as entities, so text from the input file cannot break the table, make a link or be read as HTML.
export function mdCell(t) {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[[\]`]/g, (c) => `\\${c}`)
    .replace(/\r?\n|\r/g, ' ');
}

export function toMarkdown(r) {
  const lines = [`## service-coupling-check: ${countsLine(r.counts)}`, '', `Files: ${r.compose.files.map((f) => `\`${f.path.replace(/[`\r\n]/g, "'")}\``).join(', ')}. ${mdCell(composeLine(r))}.`];
  lines.push('', '| Area | Result | Detail |', '| --- | --- | --- |');
  for (const a of r.areas) lines.push(`| ${mdCell(a.title)} | ${a.result === 'fail' ? '**fail**' : mdCell(a.result)} | ${mdCell(a.detail)} |`);
  if (r.services.length) {
    lines.push('', '| Service | Kind | Fan-in | Fan-out | Chain | Healthcheck |', '| --- | --- | --- | --- | --- | --- |');
    for (const s of r.services) lines.push(`| ${mdCell(s.name)} | ${s.kind} | ${s.fanIn} | ${s.fanOut} | ${s.chain} | ${s.healthcheck} |`);
  }
  if (!r.findings.length) lines.push('', 'No findings.');
  for (const g of groups(r)) {
    lines.push('', `### ${mdCell(g.title)}`, '', '| Severity | Check | Where | Message | Basis | Fix |', '| --- | --- | --- | --- | --- | --- |');
    for (const f of g.findings) {
      const basis = f.basis.map((b) => `"${b.text}" (${b.section}, ${b.source})`).join(' ');
      lines.push(`| ${f.severity} | ${mdCell(f.id)} | ${mdCell(`${where(f)} (line ${f.line})`)} | ${mdCell(f.message)} | ${mdCell(basis)} | ${mdCell(f.fix)} |`);
    }
  }
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`- ${mdCell(note)}`);
  lines.push('', r.gate.pass ? `**Gate passed** (--fail-on ${r.gate.failOn}).` : `**Gate failed:** ${mdCell(r.gate.reason)}.`);
  return lines.join('\n') + '\n';
}

export function toJson(r) {
  return JSON.stringify(r, null, 2) + '\n';
}

// RFC 4180 quoting, and a leading quote on cells a spreadsheet would read as a formula.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per finding.
export function toCsv(r) {
  const rows = [['severity', 'area', 'id', 'file', 'where', 'line', 'subject', 'message', 'basis', 'source', 'fix']];
  for (const f of r.findings) rows.push([f.severity, f.area, f.id, f.file, f.where, String(f.line), f.subject, f.message, f.basis.map((b) => b.text).join(' '), f.source, f.fix]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
