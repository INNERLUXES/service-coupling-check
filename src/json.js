// A small, strict JSON reader that keeps the line of every value, so a finding can point at the line of a token
// or of a rule. It accepts the JSON of RFC 8259 and nothing more: no comments, no trailing commas, no single
// quotes. Keys are kept in a list (never as properties of an object), so a key such as __proto__ is just a
// name, and nesting deeper than the limit is refused. A key given twice in one object is refused, unless the
// caller asks to keep both.
//
// A value is { t, line, ... }: t is 'object' (props: [{ key, line, value }]), 'array' (items), 'string',
// 'number', 'boolean' or 'null' (value).

export const JSON_LIMITS = { maxDepth: 64, maxNodes: 200_000 };

const SPACE = /[ \t\r\n]/;

function shown(text) {
  return String(text).replace(/[^ -~]/g, '?').slice(0, 40);
}

export function parseJson(text, label = 'input', { limits = JSON_LIMITS, allowDuplicateKeys = false } = {}) {
  const s = String(text).replace(/^\ufeff/, '');
  let i = 0;
  let line = 1;
  let nodes = 0;
  const fail = (message) => {
    throw new Error(`${label}: line ${line}: ${message}`);
  };
  const skip = () => {
    while (i < s.length && SPACE.test(s[i])) {
      if (s[i] === '\n') line += 1;
      i += 1;
    }
  };
  const count = () => {
    nodes += 1;
    if (nodes > limits.maxNodes) fail(`more than ${limits.maxNodes.toLocaleString('en-US')} values`);
  };

  function readString() {
    // s[i] is the opening quote
    i += 1;
    let out = '';
    for (;;) {
      if (i >= s.length) fail('a string is not closed');
      const c = s[i];
      if (c === '"') {
        i += 1;
        return out;
      }
      if (c === '\n' || c.charCodeAt(0) < 0x20) fail('a control character inside a string (write it as an escape)');
      if (c === '\\') {
        const n = s[i + 1];
        const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (n !== undefined && Object.hasOwn(simple, n)) {
          out += simple[n];
          i += 2;
        } else if (n === 'u') {
          const hex = s.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('a \\u escape needs four hex digits');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          fail(`the escape \\${shown(n ?? '')} is not valid`);
        }
        continue;
      }
      out += c;
      i += 1;
    }
  }

  function readValue(depth) {
    skip();
    if (i >= s.length) fail('a value is missing');
    if (depth > limits.maxDepth) fail(`nested more than ${limits.maxDepth} deep`);
    count();
    const start = line;
    const c = s[i];
    if (c === '{') {
      i += 1;
      const props = [];
      const seen = new Set();
      skip();
      if (s[i] === '}') {
        i += 1;
        return { t: 'object', line: start, props };
      }
      for (;;) {
        skip();
        if (s[i] !== '"') fail('a key in quotes is expected');
        const keyLine = line;
        const key = readString();
        if (seen.has(key) && !allowDuplicateKeys) {
          line = keyLine;
          fail(`the key "${shown(key)}" appears twice in one object`);
        }
        seen.add(key);
        skip();
        if (s[i] !== ':') fail('a ":" is expected after a key');
        i += 1;
        props.push({ key, line: keyLine, value: readValue(depth + 1) });
        skip();
        if (s[i] === ',') {
          i += 1;
          continue;
        }
        if (s[i] === '}') {
          i += 1;
          return { t: 'object', line: start, props };
        }
        fail('a "," or "}" is expected');
      }
    }
    if (c === '[') {
      i += 1;
      const items = [];
      skip();
      if (s[i] === ']') {
        i += 1;
        return { t: 'array', line: start, items };
      }
      for (;;) {
        items.push(readValue(depth + 1));
        skip();
        if (s[i] === ',') {
          i += 1;
          continue;
        }
        if (s[i] === ']') {
          i += 1;
          return { t: 'array', line: start, items };
        }
        fail('a "," or "]" is expected');
      }
    }
    if (c === '"') return { t: 'string', line: start, value: readString() };
    for (const [word, value, t] of [['true', true, 'boolean'], ['false', false, 'boolean'], ['null', null, 'null']]) {
      if (s.startsWith(word, i)) {
        i += word.length;
        return { t, line: start, value };
      }
    }
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(s.slice(i, i + 64));
    if (m) {
      i += m[0].length;
      return { t: 'number', line: start, value: Number(m[0]) };
    }
    return fail(`an unexpected character "${shown(c)}"`);
  }

  const root = readValue(0);
  skip();
  if (i < s.length) fail('text after the end of the value');
  return root;
}

// The first property with this key of an object node, or undefined.
export function propOf(node, key) {
  return node.props.find((p) => p.key === key);
}
