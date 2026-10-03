// A small, strict reader for the part of YAML that Compose files use. It is not a general YAML parser, and it
// does not try to be one.
//
// Read:    block maps and block sequences (a sequence may sit at the same indent as its key), flow sequences and flow
//          maps (nested, on one line or several), plain, single-quoted and double-quoted scalars (on one line or
//          several), the block scalars | and > with their chomping and indent indicators, comments, and the document
//          separators --- and ... .
// Refused: anchors (&name), aliases (*name), tags (!x and !!x), merge keys (<<), complex keys (?), directives (%),
//          tabs in indentation, control characters, duplicate keys, and text after a closing quote or bracket.
//
// Anchors and aliases are refused on purpose. An alias makes a node that many others point to, so a few hundred bytes
// can expand to gigabytes when a reader copies the nodes (the "billion laughs" file). A reader that never builds an
// alias has no expansion to bound. Tags can ask a loader to build objects of a named type. Neither is needed to read
// the fields a check looks at, and a Compose file that uses them is refused with the line, never half read. Compose itself
// documents the tags !reset and !override for merging files; they are refused here too, so such a file is not read.
//
// The reader is linear in the size of the input: each line is looked at a bounded number of times, each character of a
// scalar is read once, and a node deeper than the depth limit is an error. Every line number in the result is the line
// of the key (or of the first character of a value that has no key), counted from 1 in the file.

export const YAML_LIMITS = {
  maxDepth: 64,
  maxNodes: 200000,
  maxScalarChars: 262144,
  maxDocuments: 500
};

export class YamlError extends Error {
  constructor(line, message) {
    super(message);
    this.name = 'YamlError';
    this.line = line;
  }
}

// ---- nodes

const scalar = (value, style, line) => ({ type: 'scalar', value, style, line });
const nullNode = (line) => scalar('', 'empty', line);

function mapNode(line) {
  return { type: 'map', line, entries: [], index: new Map() };
}

function addEntry(map, key, keyLine, value) {
  if (map.index.has(key)) throw new YamlError(keyLine, `duplicate key "${shorten(key)}": the first one is on line ${map.index.get(key).line}, and a reader cannot know which one Compose would use`);
  const entry = { key, line: keyLine, value };
  map.entries.push(entry);
  map.index.set(key, entry);
}

const seqNode = (line) => ({ type: 'seq', line, items: [] });

export const isMap = (n) => n !== undefined && n !== null && n.type === 'map';
export const isSeq = (n) => n !== undefined && n !== null && n.type === 'seq';
export const isScalar = (n) => n !== undefined && n !== null && n.type === 'scalar';

// The entry of a map ({ key, line, value }), or undefined.
export function entryOf(node, key) {
  return isMap(node) ? node.index.get(key) : undefined;
}

// The value node of a key, or undefined.
export function get(node, key) {
  const e = entryOf(node, key);
  return e === undefined ? undefined : e.value;
}

function shorten(text, max = 40) {
  const flat = String(text).split(/[\u0000-\u001f\u007f]/).join(' ');
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

// What a plain scalar means in the YAML 1.2 core schema. A quoted scalar and a block scalar are always strings.
// kind is null, boolean, integer, float, ambiguous (a word that older YAML read as a boolean: yes, no, on, off, y, n)
// or string.
const AMBIGUOUS = new Set(['y', 'Y', 'yes', 'Yes', 'YES', 'n', 'N', 'no', 'No', 'NO', 'on', 'On', 'ON', 'off', 'Off', 'OFF']);

function allDigits(text, from) {
  if (from >= text.length) return false;
  for (let i = from; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

export function resolveScalar(node) {
  if (node.style !== 'plain') {
    return node.style === 'empty' ? { kind: 'null', value: null } : { kind: 'string', value: node.value };
  }
  const v = node.value;
  if (v === '' || v === '~' || v === 'null' || v === 'Null' || v === 'NULL') return { kind: 'null', value: null };
  if (v === 'true' || v === 'True' || v === 'TRUE') return { kind: 'boolean', value: true };
  if (v === 'false' || v === 'False' || v === 'FALSE') return { kind: 'boolean', value: false };
  if (AMBIGUOUS.has(v)) return { kind: 'ambiguous', value: v };
  if (v.length <= 24) {
    const signed = v[0] === '-' || v[0] === '+' ? 1 : 0;
    if (allDigits(v, signed)) return { kind: 'integer', value: Number(v) };
    if (/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/.test(v)) return { kind: 'float', value: Number(v) };
  }
  return { kind: 'string', value: v };
}

// ---- documents

const isBlankText = (s) => {
  for (let i = 0; i < s.length; i += 1) if (s[i] !== ' ' && s[i] !== '\t') return false;
  return true;
};

// Splits text into lines (LF, CRLF or CR) without a regular expression, so the cost is one pass.
export function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13) {
      lines.push(text.slice(start, i));
      if (c === 13 && text.charCodeAt(i + 1) === 10) i += 1;
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function hasControl(s) {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if ((c < 32 && c !== 9) || c === 127) return true;
  }
  return false;
}

// A document separator is --- or ... at the start of a line, followed by a space, a tab or the end of the line.
function separator(s, mark) {
  return s.startsWith(mark) && (s.length === 3 || s[3] === ' ' || s[3] === '\t') ? true : false;
}

// Reads every document of a text. Returns { documents, errors }: documents is a list of { line, root } (line is the
// first line of the document, root the node), errors a list of { line, message } for a document that could not be
// read. A document that holds only comments is not listed. Never throws for the content of the text.
export function readDocuments(text, limits = YAML_LIMITS) {
  const documents = [];
  const errors = [];
  const lines = splitLines(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  let current = [];
  let first = 1;
  let pendingError = null;
  let stopped = false;

  const flush = () => {
    const live = current.some((l) => {
      const t = l.trimStart();
      return t !== '' && t[0] !== '#';
    });
    if (pendingError !== null) errors.push(pendingError);
    else if (live) {
      if (documents.length + errors.length >= limits.maxDocuments) {
        if (!stopped) errors.push({ line: first, message: `more than ${limits.maxDocuments} documents in one file; the rest is not read` });
        stopped = true;
      } else {
        try {
          documents.push({ line: first, root: new Parser(current, first, limits).parse() });
        } catch (error) {
          if (!(error instanceof YamlError)) throw error;
          errors.push({ line: error.line, message: error.message });
        }
      }
    }
    current = [];
    pendingError = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const s = lines[i];
    if (separator(s, '---') || separator(s, '...')) {
      flush();
      first = i + 2;
      if (s.startsWith('---')) {
        const rest = s.slice(3);
        if (!isBlankText(rest) && rest.trimStart()[0] !== '#') pendingError = { line: i + 1, message: 'content on the same line as --- is not supported; start the document on the next line' };
      }
      continue;
    }
    if (pendingError === null && hasControl(s)) pendingError = { line: i + 1, message: 'a control character is not allowed in a Compose file' };
    current.push(s);
  }
  flush();
  return { documents, errors };
}

// ---- the parser

const REFUSED = {
  '&': 'an anchor (&name) is refused: an anchor and its alias let a small file expand into a huge one, so this reader does not build them',
  '*': 'an alias (*name) is refused: an alias lets a small file expand into a huge one, so this reader does not build them',
  '!': 'a tag (! or !!) is refused: a tag asks the loader to build a typed value or (with !reset and !override) to change how files merge, and this reader builds neither'
};

function classify(s) {
  let i = 0;
  while (i < s.length && s[i] === ' ') i += 1;
  if (i === s.length) return { kind: 'blank', ind: i, start: i };
  if (s[i] === '\t') {
    let j = i;
    while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j += 1;
    return j === s.length ? { kind: 'blank', ind: j, start: j } : { kind: 'tab', ind: i, start: j };
  }
  return { kind: s[i] === '#' ? 'comment' : 'content', ind: i, start: i };
}

class Parser {
  constructor(rawLines, firstLine, limits) {
    this.limits = limits;
    this.lines = rawLines.map((s, k) => ({ s, no: firstLine + k, ...classify(s) }));
    this.i = 0;
    this.nodes = 0;
  }

  fail(no, message) {
    throw new YamlError(no, message);
  }

  count(no) {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) this.fail(no, `more than ${this.limits.maxNodes} nodes in one document; the rest is not read`);
  }

  // The next line with content (skips blank lines and comment lines); null at the end.
  peek() {
    while (this.i < this.lines.length) {
      const l = this.lines[this.i];
      if (l.kind === 'blank' || l.kind === 'comment') {
        this.i += 1;
        continue;
      }
      if (l.kind === 'tab') this.fail(l.no, 'a tab is not allowed in indentation; use spaces');
      return l;
    }
    return null;
  }

  parse() {
    const line = this.peek();
    if (line === null) return nullNode(1);
    const root = this.parseAt(line, -1, 0);
    const rest = this.peek();
    if (rest !== null) this.fail(rest.no, 'unexpected content: the indentation does not match the lines above it');
    return root;
  }

  parseAt(line, parentIndent, depth) {
    if (depth > this.limits.maxDepth) this.fail(line.no, `nesting is deeper than ${this.limits.maxDepth} levels`);
    const s = line.s;
    const c = s[line.start];
    if (c === '&' || c === '*' || c === '!') this.fail(line.no, REFUSED[c]);
    if (c === '%') this.fail(line.no, 'a directive (%) is not supported');
    if (c === '@' || c === '`') this.fail(line.no, `a value cannot start with ${c}`);
    if (c === '?' && (s.length === line.start + 1 || s[line.start + 1] === ' ')) this.fail(line.no, 'a complex key (?) is not supported');
    if (this.isItem(line)) return this.parseSeq(line.ind, depth);
    if (this.splitKey(line) !== null) return this.parseMap(line.ind, depth);
    this.i += 1;
    return this.parseInline(line, line.start, parentIndent, depth);
  }

  isItem(line) {
    const s = line.s;
    const at = line.start;
    return s[at] === '-' && (at + 1 === s.length || s[at + 1] === ' ' || s[at + 1] === '\t');
  }

  // Finds "key:" at the start of a line. Returns { key, style, value } where value is the index after the colon, or null
  // when the line is not a key line.
  splitKey(line) {
    const s = line.s;
    let p = line.start;
    const c = s[p];
    if (c === '"' || c === "'") {
      let q = p + 1;
      const out = [];
      for (;;) {
        if (q >= s.length) return null;
        const d = s[q];
        if (c === '"' && d === '\\') {
          const r = decodeEscape(s, q);
          if (r === null) return null;
          out.push(r.text);
          q = r.next;
          continue;
        }
        if (d === c) {
          if (c === "'" && s[q + 1] === "'") {
            out.push("'");
            q += 2;
            continue;
          }
          break;
        }
        out.push(d);
        q += 1;
      }
      let r = q + 1;
      while (r < s.length && s[r] === ' ') r += 1;
      if (s[r] === ':' && (r + 1 === s.length || s[r + 1] === ' ' || s[r + 1] === '\t')) return { key: out.join(''), style: c === '"' ? 'double' : 'single', value: r + 1 };
      return null;
    }
    if (c === '[' || c === '{' || c === '|' || c === '>') return null;
    for (; p < s.length; p += 1) {
      const d = s[p];
      if (d === '#' && p > line.start && (s[p - 1] === ' ' || s[p - 1] === '\t')) return null;
      if (d === ':' && (p + 1 === s.length || s[p + 1] === ' ' || s[p + 1] === '\t')) {
        const key = s.slice(line.start, p).trimEnd();
        return key === '' ? null : { key, style: 'plain', value: p + 1 };
      }
    }
    return null;
  }

  parseMap(indent, depth) {
    const first = this.lines[this.i];
    const map = mapNode(first === undefined ? 1 : first.no);
    for (;;) {
      const line = this.peek();
      if (line === null || line.ind < indent) break;
      if (line.ind > indent) this.fail(line.no, 'unexpected indentation');
      const c = line.s[line.start];
      if (c === '&' || c === '*' || c === '!') this.fail(line.no, REFUSED[c]);
      if (this.isItem(line)) this.fail(line.no, 'a list item where a key was expected: the indentation does not match the lines above it');
      const k = this.splitKey(line);
      if (k === null) this.fail(line.no, 'expected "key: value" here');
      if (k.style === 'plain' && k.key === '<<') this.fail(line.no, 'a merge key (<<) is refused: it copies the nodes of an alias, and aliases are not built by this reader');
      this.count(line.no);
      const value = this.valueAfterKey(line, k.value, indent, depth);
      addEntry(map, k.key, line.no, value);
    }
    return map;
  }

  valueAfterKey(line, from, indent, depth) {
    const s = line.s;
    let p = from;
    while (p < s.length && (s[p] === ' ' || s[p] === '\t')) p += 1;
    this.i += 1;
    if (p >= s.length || (s[p] === '#' && p > from)) {
      const next = this.peek();
      if (next !== null && next.ind > indent) return this.parseAt(next, indent, depth + 1);
      if (next !== null && next.ind === indent && this.isItem(next)) return this.parseSeq(indent, depth + 1);
      return nullNode(line.no);
    }
    if (s[p] === '|' || s[p] === '>') return this.blockScalar(line, p, indent);
    return this.parseInline(line, p, indent, depth);
  }

  parseSeq(indent, depth) {
    const first = this.lines[this.i];
    const seq = seqNode(first === undefined ? 1 : first.no);
    for (;;) {
      const line = this.peek();
      if (line === null || line.ind < indent) break;
      if (line.ind > indent) this.fail(line.no, 'unexpected indentation');
      if (!this.isItem(line)) break;
      this.count(line.no);
      const s = line.s;
      let p = line.start + 1;
      while (p < s.length && (s[p] === ' ' || s[p] === '\t')) p += 1;
      if (p >= s.length || (s[p] === '#' && p > line.start + 1)) {
        this.i += 1;
        const next = this.peek();
        seq.items.push(next !== null && next.ind > indent ? this.parseAt(next, indent, depth + 1) : nullNode(line.no));
        continue;
      }
      if (s[p] === '|' || s[p] === '>') {
        this.i += 1;
        seq.items.push(this.blockScalar(line, p, indent));
        continue;
      }
      // The rest of the line is the item. Treat it as a line of its own at the column where the item starts, so a map
      // that begins on the dash line ("- name: x") reads its next keys at that column.
      line.ind += p - line.start;
      line.start = p;
      seq.items.push(this.parseAt(line, indent, depth + 1));
    }
    return seq;
  }

  // ---- scalars

  // Text after a value on its line must be empty or a comment.
  rest(line, from) {
    const s = line.s;
    let p = from;
    let spaced = false;
    while (p < s.length && (s[p] === ' ' || s[p] === '\t')) {
      p += 1;
      spaced = true;
    }
    if (p < s.length && !(s[p] === '#' && spaced)) this.fail(line.no, 'unexpected text after the end of a value');
  }

  parseInline(line, from, parentIndent, depth) {
    const s = line.s;
    let p = from;
    while (p < s.length && (s[p] === ' ' || s[p] === '\t')) p += 1;
    const c = s[p];
    if (c === '&' || c === '*' || c === '!') this.fail(line.no, REFUSED[c]);
    if (c === '%' || c === '@' || c === '`') this.fail(line.no, `a value cannot start with ${c}`);
    this.count(line.no);
    if (c === '"' || c === "'") {
      const r = this.quoted(line, p, c);
      this.rest(r.line, r.end);
      return scalar(r.value, c === '"' ? 'double' : 'single', line.no);
    }
    if (c === '[' || c === '{') {
      const r = this.flow(line, p, depth);
      this.rest(r.line, r.end);
      return r.node;
    }
    // A plain scalar, which may continue on the following lines that are indented more than the parent.
    let end = p;
    let hadComment = false;
    while (end < s.length) {
      if (s[end] === '#' && end > p && (s[end - 1] === ' ' || s[end - 1] === '\t')) {
        hadComment = true;
        break;
      }
      end += 1;
    }
    let value = s.slice(p, end).trimEnd();
    this.plainCheck(value, line.no);
    while (!hadComment) {
      let j = this.i;
      let blanks = 0;
      while (j < this.lines.length && this.lines[j].kind === 'blank') {
        blanks += 1;
        j += 1;
      }
      const next = this.lines[j];
      if (next === undefined || next.kind !== 'content' || next.ind <= parentIndent) break;
      const body = next.s.slice(next.start);
      let e = 0;
      let cut = false;
      while (e < body.length) {
        if (body[e] === '#' && e > 0 && (body[e - 1] === ' ' || body[e - 1] === '\t')) {
          cut = true;
          break;
        }
        e += 1;
      }
      const piece = body.slice(0, e).trimEnd();
      this.plainCheck(piece, next.no);
      value += (blanks > 0 ? '\n'.repeat(blanks) : ' ') + piece;
      if (value.length > this.limits.maxScalarChars) this.fail(line.no, `a value is longer than ${this.limits.maxScalarChars} characters`);
      this.i = j + 1;
      if (cut) break;
    }
    if (value.length > this.limits.maxScalarChars) this.fail(line.no, `a value is longer than ${this.limits.maxScalarChars} characters`);
    return value === '' ? nullNode(line.no) : scalar(value, 'plain', line.no);
  }

  plainCheck(text, no) {
    for (let k = 0; k < text.length; k += 1) {
      if (text[k] === ':' && (k + 1 === text.length || text[k + 1] === ' ' || text[k + 1] === '\t')) this.fail(no, 'a "key: value" pair is not allowed here: the indentation does not match the lines above it, or the value needs quotes');
    }
  }

  // A quoted scalar that may run over several lines. Returns { value, line, end }: the line it ends on and the index after
  // the closing quote. A single line break inside the value is folded to a space and a blank line is a line break, as YAML
  // says; the white space before a break and at the start of the next line is dropped.
  quoted(line, from, quote) {
    const out = [];
    let size = 0;
    const push = (text) => {
      out.push(text);
      size += text.length;
      if (size > this.limits.maxScalarChars) this.fail(line.no, `a value is longer than ${this.limits.maxScalarChars} characters`);
    };
    let cur = line;
    let p = from + 1;
    for (;;) {
      const s = cur.s;
      let run = p;
      let escapedBreak = false;
      while (p < s.length) {
        const d = s[p];
        if (d === quote) {
          if (quote === "'" && s[p + 1] === "'") {
            push(s.slice(run, p + 1));
            p += 2;
            run = p;
            continue;
          }
          push(s.slice(run, p));
          return { value: out.join(''), line: cur, end: p + 1 };
        }
        if (quote === '"' && d === '\\') {
          push(s.slice(run, p));
          if (p + 1 >= s.length) {
            escapedBreak = true;
            p = s.length;
            run = p;
            break;
          }
          const r = decodeEscape(s, p);
          if (r === null) this.fail(cur.no, 'an escape sequence in a double-quoted value is not valid');
          push(r.text);
          p = r.next;
          run = p;
          continue;
        }
        p += 1;
      }
      push(escapedBreak ? '' : s.slice(run).trimEnd());
      // The line ended inside the value: go to the next one.
      let blanks = 0;
      let j = this.i;
      while (j < this.lines.length && isBlankText(this.lines[j].s)) {
        blanks += 1;
        j += 1;
      }
      if (j >= this.lines.length) this.fail(line.no, 'a quoted value is never closed');
      push(blanks > 0 ? '\n'.repeat(blanks) : escapedBreak ? '' : ' ');
      cur = this.lines[j];
      this.i = j + 1;
      p = 0;
      while (p < cur.s.length && (cur.s[p] === ' ' || cur.s[p] === '\t')) p += 1;
    }
  }

  // A flow collection, which may run over several lines. Returns { node, line, end }.
  flow(line, from, depth) {
    const text = [];
    const starts = [{ at: 0, no: line.no }];
    let cur = line;
    let p = from;
    let level = 0;
    let quote = null;
    let last = '';
    let size = 0;
    done: for (;;) {
      const s = cur.s;
      while (p < s.length) {
        const d = s[p];
        if (quote !== null) {
          text.push(d);
          if (quote === '"' && d === '\\' && p + 1 < s.length) {
            text.push(s[p + 1]);
            p += 2;
            continue;
          }
          if (d === quote) quote = null;
          p += 1;
          continue;
        }
        if ((d === '"' || d === "'") && (last === '' || '[{,:'.includes(last))) quote = d;
        else if (d === '#' && p > 0 && (s[p - 1] === ' ' || s[p - 1] === '\t')) break;
        else if (d === '[' || d === '{') level += 1;
        else if (d === ']' || d === '}') {
          level -= 1;
          if (level === 0) {
            text.push(d);
            p += 1;
            break done;
          }
        }
        if (d !== ' ' && d !== '\t') last = d;
        text.push(d);
        p += 1;
        size += 1;
        if (size > this.limits.maxScalarChars * 4) this.fail(line.no, 'a flow collection is too long');
      }
      // end of this line, inside the collection
      if (this.i >= this.lines.length) this.fail(line.no, 'a flow collection ([ ] or { }) is never closed');
      cur = this.lines[this.i];
      this.i += 1;
      text.push('\n');
      starts.push({ at: text.length, no: cur.no });
      p = 0;
    }
    const reader = new FlowReader(text.join(''), starts, this);
    const node = reader.parseTop(depth + 1);
    return { node, line: cur, end: p };
  }

  // A block scalar (| or >). line is the line of the header, p the index of the indicator, parent the indent of the
  // parent node.
  blockScalar(line, p, parent) {
    const s = line.s;
    const style = s[p];
    let chomp = 'clip';
    let explicit = 0;
    let q = p + 1;
    while (q < s.length && s[q] !== ' ' && s[q] !== '\t') {
      const d = s[q];
      if (d === '-') chomp = 'strip';
      else if (d === '+') chomp = 'keep';
      else if (d >= '1' && d <= '9') explicit = Number(d);
      else this.fail(line.no, 'the header of a block scalar is not valid');
      q += 1;
    }
    this.rest(line, q);
    this.count(line.no);
    let indent = explicit > 0 ? Math.max(parent, 0) + explicit : -1;
    const body = [];
    let size = 0;
    while (this.i < this.lines.length) {
      const l = this.lines[this.i];
      if (isBlankText(l.s)) {
        body.push('');
        this.i += 1;
        continue;
      }
      let lead = 0;
      while (lead < l.s.length && l.s[lead] === ' ') lead += 1;
      if (indent === -1) {
        if (lead <= parent) break;
        indent = lead;
      }
      if (lead < indent) break;
      const text = l.s.slice(indent);
      size += text.length;
      if (size > this.limits.maxScalarChars) this.fail(line.no, `a value is longer than ${this.limits.maxScalarChars} characters`);
      body.push(text);
      this.i += 1;
    }
    let trail = 0;
    while (trail < body.length && body[body.length - 1 - trail] === '') trail += 1;
    const content = body.slice(0, body.length - trail);
    let value;
    if (style === '|') value = content.join('\n');
    else {
      value = '';
      let prevBlank = false;
      let started = false;
      for (const t of content) {
        if (t === '') {
          value += '\n';
          prevBlank = true;
          continue;
        }
        value += started && !prevBlank ? ` ${t}` : t;
        started = true;
        prevBlank = false;
      }
    }
    if (content.length > 0 && chomp !== 'strip') value += '\n';
    if (chomp === 'keep') value += '\n'.repeat(trail);
    return scalar(value, 'block', line.no);
  }
}

// ---- escapes

const SIMPLE_ESCAPES = { 0: '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\u0085', _: '\u00a0', L: '\u2028', P: '\u2029' };
const HEX = { x: 2, u: 4, U: 8 };

// The escape that starts at s[p] === "\\". Returns { text, next } or null when it is not valid.
function decodeEscape(s, p) {
  const d = s[p + 1];
  if (d === undefined) return null;
  if (Object.hasOwn(HEX, d)) {
    const digits = s.slice(p + 2, p + 2 + HEX[d]);
    if (digits.length !== HEX[d]) return null;
    for (let i = 0; i < digits.length; i += 1) if (!/[0-9a-fA-F]/.test(digits[i])) return null;
    const code = parseInt(digits, 16);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
    return { text: String.fromCodePoint(code), next: p + 2 + HEX[d] };
  }
  if (Object.hasOwn(SIMPLE_ESCAPES, d)) return { text: SIMPLE_ESCAPES[d], next: p + 2 };
  return null;
}

// ---- flow collections

class FlowReader {
  constructor(text, starts, parser) {
    this.t = text;
    this.p = 0;
    this.starts = starts;
    this.k = 0;
    this.parser = parser;
  }

  lineAt(pos) {
    while (this.k + 1 < this.starts.length && this.starts[this.k + 1].at <= pos) this.k += 1;
    return this.starts[this.k].no;
  }

  fail(message) {
    this.parser.fail(this.lineAt(this.p), message);
  }

  skip() {
    while (this.p < this.t.length && (this.t[this.p] === ' ' || this.t[this.p] === '\t' || this.t[this.p] === '\n')) this.p += 1;
  }

  parseTop(depth) {
    const node = this.value(depth);
    return node;
  }

  value(depth) {
    this.skip();
    const no = this.lineAt(this.p);
    if (depth > this.parser.limits.maxDepth) this.fail(`nesting is deeper than ${this.parser.limits.maxDepth} levels`);
    this.parser.count(no);
    const c = this.t[this.p];
    if (c === '[') return this.seq(depth);
    if (c === '{') return this.map(depth);
    if (c === '"' || c === "'") return this.quote(c, no);
    if (c === '&' || c === '*' || c === '!') this.fail(REFUSED[c]);
    if (c === undefined) this.fail('a value is missing');
    return this.plain(no);
  }

  quote(c, no) {
    const out = [];
    this.p += 1;
    for (;;) {
      if (this.p >= this.t.length) this.fail('a quoted value is never closed');
      const d = this.t[this.p];
      if (d === c) {
        if (c === "'" && this.t[this.p + 1] === "'") {
          out.push("'");
          this.p += 2;
          continue;
        }
        this.p += 1;
        break;
      }
      if (c === '"' && d === '\\') {
        const r = decodeEscape(this.t, this.p);
        if (r === null) this.fail('an escape sequence in a double-quoted value is not valid');
        out.push(r.text);
        this.p = r.next;
        continue;
      }
      out.push(d === '\n' ? ' ' : d);
      this.p += 1;
      if (out.length > this.parser.limits.maxScalarChars) this.fail(`a value is longer than ${this.parser.limits.maxScalarChars} characters`);
    }
    return scalar(out.join(''), c === '"' ? 'double' : 'single', no);
  }

  plain(no) {
    const start = this.p;
    while (this.p < this.t.length) {
      const d = this.t[this.p];
      if (d === ',' || d === ']' || d === '}' || d === '[' || d === '{') break;
      if (d === ':') {
        const n = this.t[this.p + 1];
        if (n === undefined || n === ' ' || n === '\t' || n === '\n' || n === ',' || n === ']' || n === '}') break;
      }
      this.p += 1;
    }
    const value = this.t.slice(start, this.p).split('\n').map((x) => x.trim()).join(' ').trim();
    if (value === '') this.fail('a value is missing');
    if (value.length > this.parser.limits.maxScalarChars) this.fail(`a value is longer than ${this.parser.limits.maxScalarChars} characters`);
    return scalar(value, 'plain', no);
  }

  seq(depth) {
    const seq = seqNode(this.lineAt(this.p));
    this.p += 1;
    for (;;) {
      this.skip();
      if (this.t[this.p] === ']') {
        this.p += 1;
        return seq;
      }
      const item = this.value(depth + 1);
      this.skip();
      if (this.t[this.p] === ':') this.fail('a "key: value" pair inside [ ] is not supported; use { } for a map');
      seq.items.push(item);
      if (this.t[this.p] === ',') {
        this.p += 1;
        continue;
      }
      if (this.t[this.p] === ']') {
        this.p += 1;
        return seq;
      }
      this.fail('expected "," or "]" in a flow list');
    }
  }

  map(depth) {
    const map = mapNode(this.lineAt(this.p));
    this.p += 1;
    for (;;) {
      this.skip();
      if (this.t[this.p] === '}') {
        this.p += 1;
        return map;
      }
      const c = this.t[this.p];
      if (c === '[' || c === '{') this.fail('a list or a map as a key is not supported');
      const keyAt = this.lineAt(this.p);
      const key = this.value(depth + 1);
      if (key.style === 'empty') this.fail('a key is missing');
      this.skip();
      let value = nullNode(keyAt);
      if (this.t[this.p] === ':') {
        this.p += 1;
        this.skip();
        if (this.t[this.p] !== ',' && this.t[this.p] !== '}') value = this.value(depth + 1);
        this.skip();
      }
      if (key.style === 'plain' && key.value === '<<') this.parser.fail(keyAt, 'a merge key (<<) is refused: it copies the nodes of an alias, and aliases are not built by this reader');
      addEntry(map, key.value, keyAt, value);
      if (this.t[this.p] === ',') {
        this.p += 1;
        continue;
      }
      if (this.t[this.p] === '}') {
        this.p += 1;
        return map;
      }
      this.fail('expected "," or "}" in a flow map');
    }
  }
}

// ---- one Compose file

// Reads the text of one Compose file: exactly one YAML document. Returns the same nodes as the JSON reader in json.js:
// { t: 'object', line, props: [{ key, line, value }] }, { t: 'array', line, items }, or a scalar { t, line, value } with t
// 'string', 'number', 'boolean' or 'null'. A word that older YAML read as a boolean (yes, no, on, off) is a string, as
// YAML 1.2 says. A document the reader refuses, or a second document, throws an Error with the line.
export function parseYaml(text, label = 'input', limits = YAML_LIMITS) {
  const { documents, errors } = readDocuments(String(text), { ...limits, maxDocuments: 2 });
  if (errors.length) throw new Error(`${label}: line ${errors[0].line}: ${errors[0].message}`);
  if (documents.length > 1) throw new Error(`${label}: line ${documents[1].line}: a second document; a Compose file holds one`);
  if (documents.length === 0) return { t: 'null', line: 1, value: null };
  const convert = (node) => {
    if (isMap(node)) return { t: 'object', line: node.line, props: node.entries.map((e) => ({ key: e.key, line: e.line, value: convert(e.value) })) };
    if (isSeq(node)) return { t: 'array', line: node.line, items: node.items.map(convert) };
    const r = resolveScalar(node);
    if (r.kind === 'null') return { t: 'null', line: node.line, value: null };
    if (r.kind === 'boolean') return { t: 'boolean', line: node.line, value: r.value };
    if (r.kind === 'integer' || r.kind === 'float') return { t: 'number', line: node.line, value: r.value };
    return { t: 'string', line: node.line, value: String(r.value) };
  };
  return convert(documents[0].root);
}
