/**
 * SSRF guard for outbound connections to user-supplied destinations
 * (webhook URLs, external data-source hosts). Blocks requests that would reach
 * loopback, private, link-local, or cloud-metadata addresses — including the
 * Fly 6PN network (fdaa::/16, a ULA) that fronts our own internal services.
 *
 * The check RESOLVES the hostname and inspects every resolved address, so it
 * catches names that point at private space, IPv4-mapped IPv6, and numeric /
 * obfuscated IP literals (getaddrinfo canonicalizes `0x7f000001`, `2130706433`,
 * etc.). Callers should re-run assertPublicUrl right before the fetch/connect
 * to shrink the DNS-rebinding window.
 *
 * Node runtime only (uses `dns`/`net`). Do not import into edge/middleware.
 */

import "server-only";
import { promises as dns } from "node:dns";
import net from "node:net";

// SSRF via user-supplied hosts is a MULTI-TENANT concern: on the hosted cloud a
// tenant must not reach Plexus's internal services or cloud metadata. On a
// single-tenant self-host the operator IS the only user and legitimately points
// connections at private/localhost databases, so blocking private ranges there
// is a regression, not a fix. Hence this guard is OFF by default and the cloud
// opts in with PLEXUS_BLOCK_PRIVATE_EGRESS=1. When off, URL scheme validation
// still runs but private-address enforcement is skipped.
const BLOCK_PRIVATE_EGRESS = process.env.PLEXUS_BLOCK_PRIVATE_EGRESS === "1";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

interface ParsedIp {
  version: 4 | 6;
  bytes: number[]; // 4 bytes for v4, 16 for v6
}

/** Parse an IPv4/IPv6 literal into raw bytes. Returns null if not an IP. */
function parseIp(addr: string): ParsedIp | null {
  const stripped = addr.replace(/%.*$/, ""); // drop zone id (fe80::1%eth0)
  if (net.isIPv4(stripped)) {
    return { version: 4, bytes: stripped.split(".").map((o) => parseInt(o, 10)) };
  }
  if (!net.isIPv6(stripped)) return null;

  // Expand IPv6 (handles "::" and an optional dotted-quad IPv4 tail).
  let head = stripped;
  let tailV4Bytes: number[] | null = null;
  const lastColon = head.lastIndexOf(":");
  const maybeV4 = head.slice(lastColon + 1);
  if (maybeV4.includes(".") && net.isIPv4(maybeV4)) {
    tailV4Bytes = maybeV4.split(".").map((o) => parseInt(o, 10));
    head = head.slice(0, lastColon + 1) + "0:0"; // placeholder groups
  }

  const [left, right] = head.split("::");
  const leftGroups = left ? left.split(":").filter(Boolean) : [];
  const rightGroups = right !== undefined ? right.split(":").filter(Boolean) : [];
  const missing = 8 - (leftGroups.length + rightGroups.length);
  const groups =
    right !== undefined
      ? [...leftGroups, ...Array(Math.max(missing, 0)).fill("0"), ...rightGroups]
      : leftGroups;

  const bytes: number[] = [];
  for (const g of groups) {
    const v = parseInt(g || "0", 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  if (tailV4Bytes) {
    // Replace the last 4 bytes (the two placeholder groups) with the IPv4 tail.
    bytes.splice(12, 4, ...tailV4Bytes);
  }
  if (bytes.length !== 16) return null;
  return { version: 6, bytes };
}

function isPrivateV4(b: number[]): boolean {
  const [a, b1] = b;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b1 === 254) return true; // link-local incl 169.254.169.254 metadata
  if (a === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16/12
  if (a === 192 && b1 === 168) return true; // 192.168/16
  if (a === 192 && b1 === 0) return true; // 192.0.0/24 (IETF), 192.0.2/24 (TEST-NET)
  if (a === 100 && b1 >= 64 && b1 <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4 + 255.255.255.255
  return false;
}

function isBlockedBytes(p: ParsedIp): boolean {
  if (p.version === 4) return isPrivateV4(p.bytes);

  const b = p.bytes;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d → check embedded v4
  const first10Zero = b.slice(0, 10).every((x) => x === 0);
  if (first10Zero && b[10] === 0xff && b[11] === 0xff) {
    return isPrivateV4(b.slice(12));
  }
  if (first10Zero && b[10] === 0 && b[11] === 0) {
    // ::/96 incl :: (unspecified) and ::1 (loopback)
    return true;
  }
  // NAT64 64:ff9b::/96 → embedded v4
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return isPrivateV4(b.slice(12));
  }
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 ULA (includes Fly fdaa::/16)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xff) return true; // ff00::/8 multicast
  return false;
}

/** True if an IP literal is loopback/private/link-local/reserved. */
export function isBlockedIp(addr: string): boolean {
  const p = parseIp(addr);
  return p ? isBlockedBytes(p) : false;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") || // Fly 6PN service DNS, k8s, etc.
    h.endsWith(".local") ||
    h === "metadata" ||
    h === "metadata.google.internal"
  );
}

export interface AssertUrlOptions {
  /** Allow plain http:// (default false — https only). */
  allowHttp?: boolean;
}

/**
 * Validate that a user-supplied URL is safe to fetch: allowed scheme, and the
 * host does not resolve to a private/loopback/metadata address. Throws
 * SsrfError on any violation. Returns the parsed URL on success.
 */
export async function assertPublicUrl(
  rawUrl: string,
  opts: AssertUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Invalid URL");
  }

  const allowed = opts.allowHttp ? ["http:", "https:"] : ["https:"];
  if (!allowed.includes(url.protocol)) {
    throw new SsrfError(
      opts.allowHttp
        ? "URL must use http or https"
        : "URL must use https",
    );
  }

  // Private-address enforcement is cloud-only (see BLOCK_PRIVATE_EGRESS).
  if (!BLOCK_PRIVATE_EGRESS) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(host)) {
    throw new SsrfError("URL host is not permitted");
  }
  await assertPublicHost(host);
  return url;
}

/**
 * Validate that a bare hostname/IP (as used by DB drivers) does not resolve to
 * a private/loopback/metadata address. Throws SsrfError on violation.
 */
export async function assertPublicHost(host: string): Promise<void> {
  // Cloud-only enforcement — self-host/dev connect to private hosts legitimately.
  if (!BLOCK_PRIVATE_EGRESS) return;

  const clean = host.trim().replace(/^\[|\]$/g, "");
  if (!clean) throw new SsrfError("Empty host");
  if (isBlockedHostname(clean)) throw new SsrfError("Host is not permitted");

  // Literal IP: check directly (no DNS).
  if (net.isIP(clean)) {
    if (isBlockedIp(clean)) throw new SsrfError("Host resolves to a private address");
    return;
  }

  // Hostname: resolve ALL addresses and reject if any is private. getaddrinfo
  // canonicalizes numeric/obfuscated forms, so this also covers those.
  let results: { address: string }[];
  try {
    results = await dns.lookup(clean, { all: true });
  } catch {
    throw new SsrfError("Host could not be resolved");
  }
  if (results.length === 0) throw new SsrfError("Host could not be resolved");
  for (const { address } of results) {
    if (isBlockedIp(address)) {
      throw new SsrfError("Host resolves to a private address");
    }
  }
}
