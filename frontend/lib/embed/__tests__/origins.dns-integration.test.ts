import { describe, it, expect } from "vitest";
import { createSocket } from "node:dgram";
import type { AddressInfo } from "node:net";
import { Resolver } from "node:dns/promises";
import { verifyDomainOwnership, generateVerificationToken } from "@/lib/embed/origins";

/**
 * Real-DNS integration test for domain verification. Rather than mock the
 * resolver (that's origins.test.ts), this stands up a minimal local UDP DNS
 * server that answers the TXT query, points a real node:dns Resolver at it, and
 * runs the ACTUAL verifyDomainOwnership code path — proving Verify works over
 * the real DNS wire protocol. No production DNS is touched.
 */

/** End offset of the DNS question section (name labels + qtype + qclass). */
function questionEnd(buf: Buffer): number {
  let o = 12;
  while (buf[o] !== 0) o += buf[o] + 1;
  return o + 1 + 4;
}

/** Build a minimal DNS response echoing the question with one TXT answer. */
function buildResponse(query: Buffer, txt: string): Buffer {
  const qEnd = questionEnd(query);
  const question = query.subarray(12, qEnd);
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // transaction ID
  header[2] = 0x81; // QR=1, RD=1
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(1, 6); // ANCOUNT
  const txtBuf = Buffer.from(txt, "utf8");
  const answer = Buffer.alloc(12 + 1 + txtBuf.length);
  let p = 0;
  answer[p++] = 0xc0; // name: pointer to offset 12
  answer[p++] = 0x0c;
  answer.writeUInt16BE(16, p); p += 2; // TYPE = TXT
  answer.writeUInt16BE(1, p); p += 2; // CLASS = IN
  answer.writeUInt32BE(60, p); p += 4; // TTL
  answer.writeUInt16BE(1 + txtBuf.length, p); p += 2; // RDLENGTH
  answer[p++] = txtBuf.length; // character-string length
  txtBuf.copy(answer, p);
  return Buffer.concat([header, question, answer]);
}

function startDnsServer(
  txt: string,
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const sock = createSocket("udp4");
    sock.on("message", (msg, rinfo) => {
      sock.send(buildResponse(msg, txt), rinfo.port, rinfo.address);
    });
    sock.bind(0, "127.0.0.1", () => {
      const { port } = sock.address() as AddressInfo;
      resolve({
        port,
        close: () => new Promise((r) => sock.close(() => r())),
      });
    });
  });
}

describe("verifyDomainOwnership over real DNS", () => {
  it("verifies a domain whose published TXT matches, and rejects a wrong token", async () => {
    const token = generateVerificationToken();
    const server = await startDnsServer(`plexus-verify=${token}`);
    try {
      const resolver = new Resolver();
      resolver.setServers([`127.0.0.1:${server.port}`]);
      const realResolver = (host: string) => resolver.resolveTxt(host);

      // Positive: the real DNS answer carries our token → verified.
      expect(
        await verifyDomainOwnership("app.example.com", token, realResolver),
      ).toBe(true);

      // Negative: same real DNS answer, different token → not verified.
      expect(
        await verifyDomainOwnership("app.example.com", "not-the-token", realResolver),
      ).toBe(false);
    } finally {
      await server.close();
    }
  });
});
