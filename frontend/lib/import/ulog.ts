/**
 * ULog parser — PX4 flight-log format, hand-written, browser-safe.
 *
 * Pure TypeScript over ArrayBuffer + DataView (no Node APIs, no deps) so the
 * file never leaves the user's machine: the import sheet parses locally and
 * feeds the resulting points through the normal import POST path.
 *
 * Format reference: https://docs.px4.io/main/en/dev_log/ulog_file_format.html
 *
 * Scope (v1): NUMERIC SCALAR fields only. char arrays/strings are skipped;
 * numeric fixed arrays expose each element as `field[i]` for arrays of up to
 * 4 elements (larger arrays are skipped); `_padding*` fields are skipped but
 * still counted for offsets. Nested (non-basic) field types are not extracted
 * — they only contribute their size to the layout, and if a nested type's
 * size can't be resolved, extraction of the fields AFTER it stops (fields
 * before it are unaffected).
 *
 * Timestamps: every data message's first field is `timestamp` (uint64, µs
 * since boot). Boot time is anchored to wall-clock time with this priority:
 *   1. "gps"       — first nonzero `time_utc_usec` field seen on any topic
 *                    (vehicle_gps_position / sensor_gps): that sample's boot
 *                    time maps to that UTC time.
 *   2. "utc_ref"   — info message `time_ref_utc` (int32 seconds), nonzero:
 *                    interpreted as the epoch-seconds reference for the file
 *                    header's start timestamp.
 *   3. "file_mtime" — the LAST sample is anchored to the file's lastModified
 *                    time (approximate; surfaced to the user).
 * All output timestamps are epoch-ms. Points that would land before
 * 2002-01-01 are dropped (the pipeline can't represent pre-2001-09).
 */

/** Clean, typed failure for fundamentally unparseable input. */
export class UlogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UlogError";
  }
}

export interface UlogMetric {
  /** [epoch_ms, value] pairs in log order. */
  points: [number, number][];
  count: number;
  min: number;
  max: number;
}

export type UlogAnchor = "gps" | "utc_ref" | "file_mtime";

export interface UlogMeta {
  startMs: number;
  endMs: number;
  /** Count of 'O' dropout messages in the log. */
  dropouts: number;
  /** Malformed / unsubscribed / undecodable messages skipped. */
  unreadableMessages: number;
  anchor: UlogAnchor;
  /** True when the total-point cap stopped the parse early. */
  truncated: boolean;
  /** True when parsing aborted mid-file (corruption, unknown incompat bits). */
  partial: boolean;
  /** Points dropped because they anchored before 2002-01-01. */
  droppedPreEpoch: number;
  /** Total points kept across all metrics. */
  totalPoints: number;
}

export interface ParsedUlog {
  metrics: Map<string, UlogMetric>;
  meta: UlogMeta;
}

export interface ParseUlogOptions {
  /** File.lastModified — the "file_mtime" anchor fallback. Defaults to now. */
  fileLastModifiedMs?: number;
  /** Total parsed-point cap (default 5,000,000). Injectable for tests. */
  maxPoints?: number;
}

/** ULog file magic: "ULog" 0x01 0x12 0x35. */
const MAGIC = [0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35];
/** 'S' sync message payload — resync scan target after corruption. */
const SYNC = [0x2f, 0x73, 0x13, 0x20, 0x25, 0x0c, 0xbb, 0x12];
const HEADER_SIZE = 16;
const DEFAULT_MAX_POINTS = 5_000_000;
/** Numeric arrays larger than this are skipped entirely. */
const MAX_ARRAY_ELEMENTS = 4;
/** Earliest representable output timestamp (pipeline floor is 2001-09). */
const MIN_TS_MS = Date.UTC(2002, 0, 1);

const TYPE_SIZE: Record<string, number> = {
  int8_t: 1,
  uint8_t: 1,
  int16_t: 2,
  uint16_t: 2,
  int32_t: 4,
  uint32_t: 4,
  int64_t: 8,
  uint64_t: 8,
  float: 4,
  double: 8,
  bool: 1,
  char: 1,
};

/** Basic types we extract values for (char excluded — strings are skipped). */
const NUMERIC_TYPES = new Set(
  Object.keys(TYPE_SIZE).filter((t) => t !== "char"),
);

interface FieldDef {
  type: string;
  name: string;
  /** 0 = scalar; N = fixed array of N elements. */
  arrayLen: number;
}

interface Extractor {
  /** Full metric name (topic[.NN].field or …field[i]). */
  metric: string;
  /** Byte offset within the data-message payload (after msg_id). */
  offset: number;
  type: string;
}

interface Subscription {
  /** null → undecodable format (missing def, bad timestamp field, …). */
  extractors: Extractor[] | null;
  /** Offset of a `time_utc_usec` uint64 field, if the topic has one. */
  timeUtcOffset: number | null;
}

/** Per-metric accumulator (boot-µs; anchored to epoch-ms at the end). */
interface Collector {
  bootUs: number[];
  vals: number[];
}

function readAscii(u8: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(u8[start + i]);
  return s;
}

/** Parse an 'F' payload: "message_name:type field;type field;…". */
function parseFormatDef(
  text: string,
): { name: string; fields: FieldDef[] } | null {
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  const name = text.slice(0, colon);
  const fields: FieldDef[] = [];
  for (const part of text.slice(colon + 1).split(";")) {
    if (!part) continue;
    const space = part.indexOf(" ");
    if (space <= 0) return null;
    let type = part.slice(0, space);
    const fieldName = part.slice(space + 1);
    let arrayLen = 0;
    const bracket = type.indexOf("[");
    if (bracket >= 0) {
      const len = parseInt(type.slice(bracket + 1, -1), 10);
      if (!Number.isFinite(len) || len <= 0) return null;
      arrayLen = len;
      type = type.slice(0, bracket);
    }
    fields.push({ type, name: fieldName, arrayLen });
  }
  return { name, fields };
}

function readValue(dv: DataView, offset: number, type: string): number {
  switch (type) {
    case "int8_t":
      return dv.getInt8(offset);
    case "uint8_t":
    case "bool":
      return dv.getUint8(offset);
    case "int16_t":
      return dv.getInt16(offset, true);
    case "uint16_t":
      return dv.getUint16(offset, true);
    case "int32_t":
      return dv.getInt32(offset, true);
    case "uint32_t":
      return dv.getUint32(offset, true);
    case "int64_t":
      return Number(dv.getBigInt64(offset, true));
    case "uint64_t":
      return Number(dv.getBigUint64(offset, true));
    case "float":
      return dv.getFloat32(offset, true);
    case "double":
      return dv.getFloat64(offset, true);
    default:
      return NaN;
  }
}

/**
 * Recursively resolve a format's total byte size (nested types allowed).
 * Returns null when a referenced type is unknown or cyclic — callers stop
 * computing offsets past that point.
 */
function formatSize(
  name: string,
  formats: Map<string, FieldDef[]>,
  cache: Map<string, number | null>,
  visiting: Set<string>,
): number | null {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const fields = formats.get(name);
  if (!fields || visiting.has(name)) return null;
  visiting.add(name);
  let total = 0;
  for (const f of fields) {
    const basic = TYPE_SIZE[f.type];
    const one = basic ?? formatSize(f.type, formats, cache, visiting);
    if (one == null) {
      visiting.delete(name);
      cache.set(name, null);
      return null;
    }
    total += one * Math.max(f.arrayLen, 1);
  }
  visiting.delete(name);
  cache.set(name, total);
  return total;
}

/**
 * Build the extractor list for one subscription. `prefix` is the full metric
 * prefix ("topic" or "topic.NN"). Returns null when the format is missing or
 * its first field isn't the mandatory uint64 `timestamp`.
 */
function buildSubscription(
  topic: string,
  multiId: number,
  formats: Map<string, FieldDef[]>,
  sizeCache: Map<string, number | null>,
): Subscription | null {
  const fields = formats.get(topic);
  if (!fields || fields.length === 0) return null;
  const first = fields[0];
  if (
    first.name !== "timestamp" ||
    first.type !== "uint64_t" ||
    first.arrayLen !== 0
  ) {
    return null;
  }
  const prefix =
    multiId > 0 ? `${topic}.${String(multiId).padStart(2, "0")}` : topic;
  const extractors: Extractor[] = [];
  let timeUtcOffset: number | null = null;
  let offset = 8; // past the timestamp field
  for (let i = 1; i < fields.length; i++) {
    const f = fields[i];
    const basic = TYPE_SIZE[f.type];
    if (basic === undefined) {
      // Nested type: contributes size only. Unresolvable size → offsets of
      // everything after it are unknowable; stop extracting there.
      const nested = formatSize(f.type, formats, sizeCache, new Set());
      if (nested == null) break;
      offset += nested * Math.max(f.arrayLen, 1);
      continue;
    }
    const count = Math.max(f.arrayLen, 1);
    const total = basic * count;
    const skip =
      f.name.startsWith("_padding") ||
      !NUMERIC_TYPES.has(f.type) ||
      (f.arrayLen > 0 && f.arrayLen > MAX_ARRAY_ELEMENTS);
    if (!skip) {
      if (f.arrayLen > 0) {
        for (let e = 0; e < f.arrayLen; e++) {
          extractors.push({
            metric: `${prefix}.${f.name}[${e}]`,
            offset: offset + e * basic,
            type: f.type,
          });
        }
      } else {
        extractors.push({
          metric: `${prefix}.${f.name}`,
          offset,
          type: f.type,
        });
        if (f.name === "time_utc_usec" && f.type === "uint64_t") {
          timeUtcOffset = offset;
        }
      }
    }
    offset += total;
  }
  return { extractors, timeUtcOffset };
}

/** Scan forward for the 11-byte sync message (header + payload). */
function findSync(u8: Uint8Array, from: number): number {
  // Sync message bytes: size=8 (LE), type 'S', then the 8 sync-magic bytes.
  outer: for (let i = from; i + 11 <= u8.length; i++) {
    if (u8[i] !== 0x08 || u8[i + 1] !== 0x00 || u8[i + 2] !== 0x53) continue;
    for (let j = 0; j < 8; j++) {
      if (u8[i + 3 + j] !== SYNC[j]) continue outer;
    }
    return i + 11;
  }
  return -1;
}

/**
 * Parse a ULog file in one pass. Throws UlogError only for input that isn't
 * a ULog file at all (bad magic / truncated header); everything after a valid
 * header degrades to counters + partial/truncated flags — never a raw throw.
 */
export function parseUlog(
  buffer: ArrayBuffer,
  opts: ParseUlogOptions = {},
): ParsedUlog {
  const maxPoints = opts.maxPoints ?? DEFAULT_MAX_POINTS;
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const end = u8.length;

  if (end < HEADER_SIZE) throw new UlogError("Not a ULog file (too short)");
  for (let i = 0; i < MAGIC.length; i++) {
    if (u8[i] !== MAGIC[i]) {
      throw new UlogError("Not a ULog file (bad magic)");
    }
  }
  const headerTimestampUs = Number(dv.getBigUint64(8, true));

  const formats = new Map<string, FieldDef[]>();
  const sizeCache = new Map<string, number | null>();
  const subs = new Map<number, Subscription | null>();
  const collectors = new Map<string, Collector>();

  let dropouts = 0;
  let unreadable = 0;
  let partial = false;
  let truncated = false;
  let totalPoints = 0;
  let timeRefUtc = 0;
  let gpsAnchor: { bootUs: number; utcUs: number } | null = null;
  let lastBootUs = -Infinity;
  const appendedOffsets: number[] = [];

  const collectorFor = (metric: string): Collector => {
    let c = collectors.get(metric);
    if (!c) {
      c = { bootUs: [], vals: [] };
      collectors.set(metric, c);
    }
    return c;
  };

  let offset = HEADER_SIZE;
  parse: while (offset + 3 <= end && !truncated) {
    const msgSize = dv.getUint16(offset, true);
    const msgType = u8[offset + 2];

    // Appended-data boundary: the message straddling an append offset is
    // unfinished — resume at the boundary (appended data is normal messages).
    const boundary = appendedOffsets.find(
      (b) => offset < b && offset + 3 + msgSize > b,
    );
    if (boundary !== undefined) {
      unreadable++;
      offset = boundary;
      continue;
    }

    if (offset + 3 + msgSize > end) {
      // Runs past EOF: either a cleanly truncated file (common — logger was
      // killed) or corruption. Try to resync; otherwise stop with partial.
      const resumed = findSync(u8, offset + 1);
      unreadable++;
      if (resumed >= 0) {
        offset = resumed;
        continue;
      }
      partial = true;
      break;
    }

    const payload = offset + 3;
    switch (msgType) {
      case 0x42: {
        // 'B' flag bits: compat[8], incompat[8], appended_offsets uint64[3].
        if (msgSize < 40) break;
        // Unknown incompat bit → we must not keep parsing.
        for (let i = 0; i < 8; i++) {
          const bits = u8[payload + 8 + i];
          const known = i === 0 ? 0x01 : 0x00; // bit0 byte0 = DATA_APPENDED
          if ((bits & ~known) !== 0) {
            partial = true;
            break parse;
          }
        }
        if ((u8[payload + 8] & 0x01) !== 0) {
          for (let i = 0; i < 3; i++) {
            const o = Number(dv.getBigUint64(payload + 16 + i * 8, true));
            if (o > 0) appendedOffsets.push(o);
          }
          appendedOffsets.sort((a, b) => a - b);
        }
        break;
      }
      case 0x46: {
        // 'F' format definition.
        const def = parseFormatDef(readAscii(u8, payload, msgSize));
        if (def && !formats.has(def.name)) formats.set(def.name, def.fields);
        else if (!def) unreadable++;
        break;
      }
      case 0x49: {
        // 'I' info: uint8 key_len, key "type name", value bytes.
        if (msgSize < 1) break;
        const keyLen = u8[payload];
        if (1 + keyLen > msgSize) {
          unreadable++;
          break;
        }
        const key = readAscii(u8, payload + 1, keyLen);
        if (key === "int32_t time_ref_utc" && msgSize >= 1 + keyLen + 4) {
          timeRefUtc = dv.getInt32(payload + 1 + keyLen, true);
        }
        break;
      }
      case 0x41: {
        // 'A' add logged message (subscription).
        if (msgSize < 3) {
          unreadable++;
          break;
        }
        const multiId = u8[payload];
        const msgId = dv.getUint16(payload + 1, true);
        const topic = readAscii(u8, payload + 3, msgSize - 3);
        subs.set(msgId, buildSubscription(topic, multiId, formats, sizeCache));
        break;
      }
      case 0x44: {
        // 'D' data message.
        if (msgSize < 2) {
          unreadable++;
          break;
        }
        const msgId = dv.getUint16(payload, true);
        const sub = subs.get(msgId);
        if (sub === undefined || sub === null || sub.extractors === null) {
          unreadable++;
          break;
        }
        const dataStart = payload + 2;
        const dataLen = msgSize - 2;
        if (dataLen < 8) {
          unreadable++;
          break;
        }
        const ts = Number(dv.getBigUint64(dataStart, true));
        if (ts > lastBootUs) lastBootUs = ts;
        if (!gpsAnchor && sub.timeUtcOffset !== null) {
          if (sub.timeUtcOffset + 8 <= dataLen) {
            const utc = Number(
              dv.getBigUint64(dataStart + sub.timeUtcOffset, true),
            );
            if (utc > 0) gpsAnchor = { bootUs: ts, utcUs: utc };
          }
        }
        for (const ex of sub.extractors) {
          // Trailing padding may be elided on disk — read only what's there.
          if (ex.offset + TYPE_SIZE[ex.type] > dataLen) continue;
          const v = readValue(dv, dataStart + ex.offset, ex.type);
          if (!Number.isFinite(v)) continue;
          const c = collectorFor(ex.metric);
          c.bootUs.push(ts);
          c.vals.push(v);
          totalPoints++;
          if (totalPoints >= maxPoints) {
            truncated = true;
            break;
          }
        }
        break;
      }
      case 0x4f: // 'O' dropout
        dropouts++;
        break;
      case 0x4d: // 'M' multi info
      case 0x50: // 'P' parameter
      case 0x51: // 'Q' parameter default
      case 0x52: // 'R' remove logged message
      case 0x4c: // 'L' logged string
      case 0x43: // 'C' tagged logged string
      case 0x53: // 'S' sync
        break;
      default:
        // Unknown message type: skip by size (forward compatibility).
        break;
    }
    offset += 3 + msgSize;
  }

  // ── Anchor boot-time to wall-clock ────────────────────────────────────────
  let anchor: UlogAnchor;
  let offsetMs: number;
  if (gpsAnchor) {
    anchor = "gps";
    offsetMs = gpsAnchor.utcUs / 1000 - gpsAnchor.bootUs / 1000;
  } else if (timeRefUtc !== 0) {
    anchor = "utc_ref";
    offsetMs = timeRefUtc * 1000 - headerTimestampUs / 1000;
  } else {
    anchor = "file_mtime";
    const mtime = opts.fileLastModifiedMs ?? Date.now();
    const last = lastBootUs > -Infinity ? lastBootUs : headerTimestampUs;
    offsetMs = mtime - last / 1000;
  }

  const metrics = new Map<string, UlogMetric>();
  let droppedPreEpoch = 0;
  let startMs = Infinity;
  let endMs = -Infinity;
  let kept = 0;
  for (const [name, c] of collectors) {
    const points: [number, number][] = [];
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < c.bootUs.length; i++) {
      const ms = Math.round(c.bootUs[i] / 1000 + offsetMs);
      if (ms < MIN_TS_MS) {
        droppedPreEpoch++;
        continue;
      }
      const v = c.vals[i];
      points.push([ms, v]);
      if (v < min) min = v;
      if (v > max) max = v;
      if (ms < startMs) startMs = ms;
      if (ms > endMs) endMs = ms;
    }
    if (points.length > 0) {
      kept += points.length;
      metrics.set(name, { points, count: points.length, min, max });
    }
  }

  return {
    metrics,
    meta: {
      startMs: startMs === Infinity ? 0 : startMs,
      endMs: endMs === -Infinity ? 0 : endMs,
      dropouts,
      unreadableMessages: unreadable,
      anchor,
      truncated,
      partial,
      droppedPreEpoch,
      totalPoints: kept,
    },
  };
}
