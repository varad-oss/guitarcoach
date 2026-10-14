/**
 * Address checks used to stop server-side requests reaching private networks.
 */

import { isIP } from "node:net";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Block(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !inV4Block(ip);
  if (kind !== 6) return false;
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPublicAddress(mapped[1]);
  if (v6 === "::" || v6 === "::1") return false;
  if (/^f[cd]/.test(v6)) return false; // unique local fc00::/7
  if (/^fe[89ab]/.test(v6)) return false; // link local fe80::/10
  if (/^ff/.test(v6)) return false; // multicast
  if (/^2001:db8:/.test(v6)) return false; // documentation
  if (/^64:ff9b:/.test(v6)) return false; // NAT64 can reach IPv4 private space
  if (/^::/.test(v6)) return false; // other IPv4-compatible forms
  return true;
}
