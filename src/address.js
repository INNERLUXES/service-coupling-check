// Reading the addresses in the value of one environment variable: a URL (postgres://user@db:5432/orders), a JDBC URL
// (jdbc:postgresql://db/orders), a list of host:port pairs (kafka:9092,kafka2:9092), or a bare host name in a variable
// whose name ends like a host variable (DB_HOST=db). Nothing here resolves a name or opens a connection; it only cuts the
// text. Every pattern is anchored and bounded, and a value longer than the limit is not read at all.

import { DATABASE_SCHEMES, HOST_NAME_ENDINGS, LOCAL_HOSTS } from './data.js';

export const ADDRESS_LIMITS = { maxValueChars: 4096, maxHostsPerValue: 50 };

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]{0,30}):\/\//;
const JDBC = /^jdbc:([A-Za-z0-9]{1,30})(?::[A-Za-z0-9]{1,30}){0,3}:\/\//i;
const NAME = /^[A-Za-z0-9_.-]{1,253}$/;
const PORT = /^[0-9]{1,5}$/;
const IPV4 = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

// True for a dotted IPv4 address with four parts from 0 to 255.
export function isIPv4(host) {
  const m = IPV4.exec(host);
  return m !== null && m.slice(1).every((p) => Number(p) <= 255);
}

// True for an IPv6 address (written without its brackets): hex digits, colons and at least two colons.
export function isIPv6(host) {
  return IPV6.test(host) && host.split(':').length >= 3;
}

export function isIP(host) {
  return isIPv4(host) || isIPv6(host);
}

// True for an address of this container or of no host: 127.0.0.0/8, 0.0.0.0, ::1, ::, and the local names.
export function isLocal(host) {
  const h = host.toLowerCase();
  if (LOCAL_HOSTS.includes(h)) return true;
  if (isIPv4(h)) return h.startsWith('127.') || h === '0.0.0.0';
  return h === '::1' || h === '::';
}

// A variable name that holds a bare host name: it ends with _HOST, _ADDR, _SERVER and the like, or is one of them.
export function isHostVariable(name) {
  const upper = String(name).slice(0, 200).toUpperCase();
  return HOST_NAME_ENDINGS.some((e) => upper === e || upper.endsWith(`_${e}`));
}

// One "host[:port]" or "[v6]:port" item. Returns { host, port } or null.
function hostPort(item) {
  const t = item.trim();
  if (t.startsWith('[')) {
    const close = t.indexOf(']');
    if (close < 0) return null;
    const host = t.slice(1, close);
    const rest = t.slice(close + 1);
    if (!isIPv6(host)) return null;
    if (rest === '') return { host, port: null };
    if (rest[0] !== ':' || !PORT.test(rest.slice(1))) return null;
    return { host, port: Number(rest.slice(1)) };
  }
  const colon = t.lastIndexOf(':');
  if (colon < 0) return NAME.test(t) ? { host: t, port: null } : null;
  const host = t.slice(0, colon);
  const port = t.slice(colon + 1);
  if (!NAME.test(host) || !PORT.test(port)) return null;
  return { host, port: Number(port) };
}

// The hosts, the database name and the scheme of a URL that starts at text (the scheme already cut off).
function fromAuthority(rest, scheme) {
  let end = rest.length;
  for (const c of ['/', '?', '#', ';']) {
    const at = rest.indexOf(c);
    if (at >= 0 && at < end) end = at;
  }
  let authority = rest.slice(0, end);
  const at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1);
  if (authority === '') return null;
  let database = null;
  const after = rest.slice(end);
  if (after.startsWith('/')) {
    const path = after.slice(1);
    let stop = path.length;
    for (const c of ['/', '?', '#', ';']) {
      const i = path.indexOf(c);
      if (i >= 0 && i < stop) stop = i;
    }
    if (stop > 0) database = path.slice(0, stop);
  } else if (after.startsWith(';')) {
    // jdbc:sqlserver://host:1433;databaseName=orders
    for (const part of after.slice(1).split(';').slice(0, 50)) {
      const eq = part.indexOf('=');
      if (eq > 0 && ['databasename', 'database'].includes(part.slice(0, eq).trim().toLowerCase())) database = part.slice(eq + 1).trim() || null;
    }
  }
  const items = authority.split(',');
  if (items.length > ADDRESS_LIMITS.maxHostsPerValue) return null;
  const hosts = [];
  for (const item of items) {
    if (item.includes('$')) return { scheme, hosts: [], database, interpolated: true };
    const hp = hostPort(item);
    if (hp === null) return null;
    hosts.push(hp);
  }
  return { scheme, hosts, database, interpolated: false };
}

// The addresses in one value. name is the variable name, which decides whether a bare host name is read.
// Returns null when the value holds no address the tool reads, or
// { scheme, hosts: [{ host, port }], database, interpolated, databaseScheme, tooLong }.
export function addressesOf(name, value, limits = ADDRESS_LIMITS) {
  if (typeof value !== 'string') return null;
  if (value.length > limits.maxValueChars) return { scheme: null, hosts: [], database: null, interpolated: false, databaseScheme: false, tooLong: true };
  const v = value.trim();
  if (v === '') return null;
  let result = null;
  const jdbc = JDBC.exec(v);
  if (jdbc) {
    const scheme = jdbc[1].toLowerCase();
    result = fromAuthority(v.slice(jdbc[0].length), scheme);
  } else {
    const m = SCHEME.exec(v);
    if (m) result = fromAuthority(v.slice(m[0].length), m[1].toLowerCase());
    else if (!/\s/.test(v)) {
      // host:port pairs anywhere; a bare host only in a host variable.
      const items = v.split(',');
      if (items.length <= limits.maxHostsPerValue) {
        if (items.some((i) => i.includes('$'))) {
          if (isHostVariable(name)) result = { scheme: null, hosts: [], database: null, interpolated: true };
        } else {
          const parsed = items.map(hostPort);
          const allPorts = parsed.every((p) => p !== null && p.port !== null);
          const allHosts = parsed.every((p) => p !== null);
          // A version number such as 1.2:3 is not an address: a name that is only digits and dots needs to be an IP.
          const plausible = parsed.every((p) => p === null || !/^[0-9.]+$/.test(p.host) || isIPv4(p.host));
          if (plausible && (allPorts || (allHosts && isHostVariable(name)))) result = { scheme: null, hosts: parsed, database: null, interpolated: false };
        }
      }
    }
  }
  if (result === null) return null;
  return { ...result, databaseScheme: result.scheme !== null && DATABASE_SCHEMES.includes(result.scheme), tooLong: false };
}
