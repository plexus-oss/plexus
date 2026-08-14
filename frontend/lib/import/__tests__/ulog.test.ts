/**
 * ULog parser tests.
 *
 * Fixtures are built PROGRAMMATICALLY (bytes written per the PX4 ULog spec,
 * https://docs.px4.io/main/en/dev_log/ulog_file_format.html) — nothing is
 * fetched from the network. Covers: header validation, format parsing
 * (arrays / padding / char / oversized arrays), data decoding across the
 * numeric types, multi-instance naming, all three time anchors (GPS,
 * time_ref_utc, file mtime), pre-2002 clipping, unknown-message skip,
 * dropout counting, corruption resync via 'S', and the point cap.
 */

import { describe, it, expect } from "vitest";
import { parseUlog, UlogError } from "@/lib/import/ulog";

// ── Byte helpers ────────────────────────────────────────────────────────────

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const i32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return [...b];
};
const u64 = (v: number | bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
  return [...b];
};
const i64 = (v: number | bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(v), true);
  return [...b];
};
const f32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return [...b];
};
const f64 = (v: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...b];
};

const SYNC_MSG = [
  0x08, 0x00, 0x53, 0x2f, 0x73, 0x13, 0x20, 0x25, 0x0c, 0xbb, 0x12,
];

class LogWriter {
  private bytes: number[] = [];

  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }

  /** File header: 7-byte magic, 1-byte version, uint64 start timestamp (µs). */
  header(timestampUs = 0): this {
    return this.raw(0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35, 0x01).raw(
      ...u64(timestampUs),
    );
  }

  msg(type: string, payload: number[]): this {
    return this.raw(...u16(payload.length), type.charCodeAt(0), ...payload);
  }

  /** 'B' flag bits: all-zero compat/incompat/appended offsets. */
  flagBits(): this {
    return this.msg("B", new Array(40).fill(0));
  }

  format(def: string): this {
    return this.msg("F", ascii(def));
  }

  subscribe(msgId: number, topic: string, multiId = 0): this {
    return this.msg("A", [multiId, ...u16(msgId), ...ascii(topic)]);
  }

  data(msgId: number, payload: number[]): this {
    return this.msg("D", [...u16(msgId), ...payload]);
  }

  info(key: string, value: number[]): this {
    return this.msg("I", [key.length, ...ascii(key), ...value]);
  }

  build(): ArrayBuffer {
    return Uint8Array.from(this.bytes).buffer;
  }
}

/** Minimal valid log: test_topic { uint64 timestamp; float value; }. */
function basicLog(tsValues: [number, number][]): LogWriter {
  const w = new LogWriter()
    .header(0)
    .flagBits()
    .format("test_topic:uint64_t timestamp;float value;")
    .subscribe(0, "test_topic");
  for (const [ts, v] of tsValues) w.data(0, [...u64(ts), ...f32(v)]);
  return w;
}

const MTIME = Date.UTC(2026, 0, 15); // fixed file mtime for deterministic anchors
const MIN_TS_MS = Date.UTC(2002, 0, 1);

// ── Tests ───────────────────────────────────────────────────────────────────

describe("header validation", () => {
  it("rejects non-ULog bytes", () => {
    const junk = Uint8Array.from(new Array(64).fill(0x41)).buffer;
    expect(() => parseUlog(junk)).toThrow(UlogError);
  });

  it("rejects files shorter than the header", () => {
    const short = Uint8Array.from([0x55, 0x4c, 0x6f, 0x67]).buffer;
    expect(() => parseUlog(short)).toThrow(UlogError);
  });

  it("accepts a valid header with no data", () => {
    const parsed = parseUlog(new LogWriter().header().flagBits().build());
    expect(parsed.metrics.size).toBe(0);
    expect(parsed.meta.partial).toBe(false);
  });
});

describe("data decoding", () => {
  it("decodes float data with file-mtime anchoring on the last sample", () => {
    const buf = basicLog([
      [1_000_000, 1.5],
      [2_000_000, -2.5],
      [3_000_000, 10],
    ]).build();
    const parsed = parseUlog(buf, { fileLastModifiedMs: MTIME });

    expect(parsed.meta.anchor).toBe("file_mtime");
    const m = parsed.metrics.get("test_topic.value");
    expect(m).toBeDefined();
    expect(m!.count).toBe(3);
    expect(m!.min).toBe(-2.5);
    expect(m!.max).toBe(10);
    // Last sample (3s of boot time) anchors exactly to the file mtime.
    expect(m!.points.map(([t]) => t)).toEqual([
      MTIME - 2000,
      MTIME - 1000,
      MTIME,
    ]);
    expect(parsed.meta.startMs).toBe(MTIME - 2000);
    expect(parsed.meta.endMs).toBe(MTIME);
  });

  it("decodes every numeric type, bool as 0/1", () => {
    const def =
      "types_topic:uint64_t timestamp;int8_t a;uint8_t b;int16_t c;" +
      "uint16_t d;int32_t e;uint32_t f;int64_t g;uint64_t h;float i;" +
      "double j;bool k;";
    const payload = [
      ...u64(1_000_000),
      ...[0xf6], // int8 -10
      ...[200], // uint8
      ...u16(0x8000), // int16 -32768 (LE reinterpret)
      ...u16(65535), // uint16
      ...i32(-123456), // int32
      ...i32(0x7fffffff), // uint32 2147483647
      ...i64(-(2 ** 40)), // int64
      ...u64(2 ** 40), // uint64
      ...f32(3.25), // float
      ...f64(-1234.5678), // double
      ...[1], // bool true
    ];
    const buf = new LogWriter()
      .header()
      .flagBits()
      .format(def)
      .subscribe(7, "types_topic")
      .data(7, payload)
      .build();
    const parsed = parseUlog(buf, { fileLastModifiedMs: MTIME });

    const val = (name: string) =>
      parsed.metrics.get(`types_topic.${name}`)!.points[0][1];
    expect(val("a")).toBe(-10);
    expect(val("b")).toBe(200);
    expect(val("c")).toBe(-32768);
    expect(val("d")).toBe(65535);
    expect(val("e")).toBe(-123456);
    expect(val("f")).toBe(2147483647);
    expect(val("g")).toBe(-(2 ** 40));
    expect(val("h")).toBe(2 ** 40);
    expect(val("i")).toBe(3.25);
    expect(val("j")).toBe(-1234.5678);
    expect(val("k")).toBe(1);
  });
});

describe("format parsing", () => {
  it("expands small arrays, skips padding, keeps offsets past both", () => {
    const def =
      "arr_topic:uint64_t timestamp;float[3] vec;uint8_t _padding0;int16_t after;";
    const payload = [
      ...u64(1_000_000),
      ...f32(1),
      ...f32(2),
      ...f32(3),
      0xee, // padding byte — must not surface as a metric
      ...u16(0x0400), // int16 1024
    ];
    const buf = new LogWriter()
      .header()
      .flagBits()
      .format(def)
      .subscribe(1, "arr_topic")
      .data(1, payload)
      .build();
    const parsed = parseUlog(buf, { fileLastModifiedMs: MTIME });

    expect(parsed.metrics.get("arr_topic.vec[0]")!.points[0][1]).toBe(1);
    expect(parsed.metrics.get("arr_topic.vec[1]")!.points[0][1]).toBe(2);
    expect(parsed.metrics.get("arr_topic.vec[2]")!.points[0][1]).toBe(3);
    expect(parsed.metrics.get("arr_topic.after")!.points[0][1]).toBe(1024);
    const names = [...parsed.metrics.keys()];
    expect(names.some((n) => n.includes("_padding"))).toBe(false);
  });

  it("skips char arrays and >4-element arrays but keeps later offsets", () => {
    const def =
      "skip_topic:uint64_t timestamp;char[5] name;float[8] big;float x;";
    const payload = [
      ...u64(1_000_000),
      ...ascii("hello"),
      ...Array.from({ length: 8 }, (_, i) => f32(i)).flat(),
      ...f32(42.5),
    ];
    const buf = new LogWriter()
      .header()
      .flagBits()
      .format(def)
      .subscribe(2, "skip_topic")
      .data(2, payload)
      .build();
    const parsed = parseUlog(buf, { fileLastModifiedMs: MTIME });

    expect(parsed.metrics.get("skip_topic.x")!.points[0][1]).toBe(42.5);
    const names = [...parsed.metrics.keys()];
    expect(names.some((n) => n.includes("name"))).toBe(false);
    expect(names.some((n) => n.includes("big"))).toBe(false);
  });
});

describe("multi-instance naming", () => {
  it("suffixes .NN only when multi_id > 0", () => {
    const buf = new LogWriter()
      .header()
      .flagBits()
      .format("sensor_accel:uint64_t timestamp;float x;")
      .subscribe(0, "sensor_accel", 0)
      .subscribe(1, "sensor_accel", 1)
      .data(0, [...u64(1_000_000), ...f32(1)])
      .data(1, [...u64(1_000_000), ...f32(2)])
      .build();
    const parsed = parseUlog(buf, { fileLastModifiedMs: MTIME });

    expect(parsed.metrics.get("sensor_accel.x")!.points[0][1]).toBe(1);
    expect(parsed.metrics.get("sensor_accel.01.x")!.points[0][1]).toBe(2);
  });
});

describe("time anchoring", () => {
  it("anchors to the first NONZERO gps time_utc_usec sample", () => {
    const utcUs = Date.UTC(2026, 5, 1) * 1000; // µs (safely below 2^53)
    const buf = new LogWriter()
      .header()
      .flagBits()
      .format(
        "vehicle_gps_position:uint64_t timestamp;uint64_t time_utc_usec;int32_t alt;",
      )
      .subscribe(0, "vehicle_gps_position")
      // First fix has no UTC time yet — must NOT anchor.
      .data(0, [...u64(4_000_000), ...u64(0), ...i32(100)])
      // Second fix anchors: boot 5s ↔ utcUs.
      .data(0, [...u64(5_000_000), ...u64(utcUs), ...i32(200)])
      .build();
    const parsed = parseUlog(buf, { fileLastModifiedMs: MTIME });

    expect(parsed.meta.anchor).toBe("gps");
    const utcMs = utcUs / 1000;
    const alt = parsed.metrics.get("vehicle_gps_position.alt")!;
    // offset = utcMs - 5000, so boot 4s → utcMs - 1000, boot 5s → utcMs.
    expect(alt.points.map(([t]) => t)).toEqual([utcMs - 1000, utcMs]);
  });

  it("falls back to time_ref_utc mapping the header start timestamp", () => {
    const refSec = Math.floor(Date.UTC(2026, 2, 3) / 1000);
    const buf = new LogWriter()
      .header(5_000_000) // logging started at boot 5s
      .flagBits()
      .info("int32_t time_ref_utc", i32(refSec))
      .format("test_topic:uint64_t timestamp;float value;")
      .subscribe(0, "test_topic")
      .data(0, [...u64(6_000_000), ...f32(1)])
      .build();
    const parsed = parseUlog(buf, { fileLastModifiedMs: MTIME });

    expect(parsed.meta.anchor).toBe("utc_ref");
    // offset = refSec*1000 - 5000; boot 6s → refSec*1000 + 1000.
    expect(parsed.metrics.get("test_topic.value")!.points[0][0]).toBe(
      refSec * 1000 + 1000,
    );
  });

  it("falls back to file mtime when no GPS or UTC reference exists", () => {
    const parsed = parseUlog(basicLog([[1_000_000, 1]]).build(), {
      fileLastModifiedMs: MTIME,
    });
    expect(parsed.meta.anchor).toBe("file_mtime");
    expect(parsed.metrics.get("test_topic.value")!.points[0][0]).toBe(MTIME);
  });

  it("drops points that would land before 2002", () => {
    // mtime just past the floor: the early sample (10s before the last)
    // anchors pre-2002 and must be dropped.
    const mtime = MIN_TS_MS + 1000;
    const buf = basicLog([
      [1_000_000, 1],
      [11_000_000, 2],
    ]).build();
    const parsed = parseUlog(buf, { fileLastModifiedMs: mtime });

    const m = parsed.metrics.get("test_topic.value")!;
    expect(m.count).toBe(1);
    expect(m.points).toEqual([[mtime, 2]]);
    expect(parsed.meta.droppedPreEpoch).toBe(1);
  });
});

describe("robustness", () => {
  it("skips unknown message types by size (forward compat)", () => {
    const w = new LogWriter()
      .header()
      .flagBits()
      .format("test_topic:uint64_t timestamp;float value;")
      .subscribe(0, "test_topic")
      .data(0, [...u64(1_000_000), ...f32(1)])
      .msg("Z", [1, 2, 3, 4, 5]) // unknown type — skip, don't derail
      .data(0, [...u64(2_000_000), ...f32(2)]);
    const parsed = parseUlog(w.build(), { fileLastModifiedMs: MTIME });

    expect(parsed.metrics.get("test_topic.value")!.count).toBe(2);
    expect(parsed.meta.unreadableMessages).toBe(0);
    expect(parsed.meta.partial).toBe(false);
  });

  it("counts dropout messages", () => {
    const w = basicLog([[1_000_000, 1]]).msg("O", u16(250));
    const parsed = parseUlog(w.build(), { fileLastModifiedMs: MTIME });
    expect(parsed.meta.dropouts).toBe(1);
  });

  it("counts data for unknown msg_ids as unreadable", () => {
    const w = basicLog([[1_000_000, 1]]).data(99, [...u64(1), ...f32(0)]);
    const parsed = parseUlog(w.build(), { fileLastModifiedMs: MTIME });
    expect(parsed.meta.unreadableMessages).toBe(1);
    expect(parsed.metrics.get("test_topic.value")!.count).toBe(1);
  });

  it("resyncs via the sync message after corruption", () => {
    const w = basicLog([[1_000_000, 1]])
      // Corrupt header claiming a size that runs past EOF.
      .raw(...u16(0xffff), 0x44, 1, 2, 3)
      .raw(...SYNC_MSG)
      .data(0, [...u64(2_000_000), ...f32(2)]);
    const parsed = parseUlog(w.build(), { fileLastModifiedMs: MTIME });

    expect(parsed.metrics.get("test_topic.value")!.count).toBe(2);
    expect(parsed.meta.unreadableMessages).toBeGreaterThan(0);
    expect(parsed.meta.partial).toBe(false);
  });

  it("stops with partial when corruption has no sync to recover to", () => {
    const w = basicLog([[1_000_000, 1]]).raw(...u16(0xffff), 0x44, 1, 2);
    const parsed = parseUlog(w.build(), { fileLastModifiedMs: MTIME });

    expect(parsed.metrics.get("test_topic.value")!.count).toBe(1);
    expect(parsed.meta.partial).toBe(true);
  });

  it("enforces the total point cap with a truncated flag", () => {
    const buf = basicLog([
      [1_000_000, 1],
      [2_000_000, 2],
      [3_000_000, 3],
      [4_000_000, 4],
      [5_000_000, 5],
    ]).build();
    const parsed = parseUlog(buf, { fileLastModifiedMs: MTIME, maxPoints: 3 });

    expect(parsed.meta.truncated).toBe(true);
    expect(parsed.meta.totalPoints).toBe(3);
    expect(parsed.metrics.get("test_topic.value")!.count).toBe(3);
  });
});
