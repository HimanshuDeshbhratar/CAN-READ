import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanFrame } from "../src/core/candump.js";
import { parseCandump } from "../src/core/candump.js";
import { decodeFrame, encodeFrame } from "../src/core/codec.js";
import { parseDbc } from "../src/core/dbc.js";
import { decodeLog } from "../src/core/decodeLog.js";

const dbc = parseDbc(
  readFileSync(new URL("../samples/vehicle.dbc", import.meta.url), "utf8"),
);

function frame(timestamp: number, id: number, data: number[]): CanFrame {
  return {
    timestamp,
    channel: "can0",
    id,
    extended: false,
    data: Uint8Array.from(data),
  };
}

const speedFrame = [0xf4, 0x01, 0, 0, 0, 0, 0, 0];

describe("candump input limits and validation", () => {
  it("returns an empty result for empty input", () => {
    expect(parseCandump("")).toEqual({ frames: [], warnings: [] });
  });

  it("rejects oversized input without throwing", () => {
    const result = parseCandump("(1.0) can0 100#00\n", {
      maxInputChars: 5,
    });
    expect(result.frames).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/Input rejected/);
  });

  it("rejects too many lines without throwing", () => {
    const result = parseCandump(
      "(1.0) can0 100#00\n(2.0) can0 101#00",
      { maxLines: 1 },
    );
    expect(result.frames).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/Input rejected/);
  });

  it("rejects standard IDs above 11 bits", () => {
    const result = parseCandump("(1.0) can0 FFF#00\n");
    expect(result.frames).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/exceeds 11 bits/);
  });

  it("rejects extended IDs above 29 bits", () => {
    const result = parseCandump("(1.0) can0 FFFFFFFF#00\n");
    expect(result.frames).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/exceeds 29 bits/);
  });

  it("rejects payloads larger than classic CAN", () => {
    const result = parseCandump("(1.0) can0 100#001122334455667788\n");
    expect(result.frames).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/payload is 9 bytes/);
  });

  it("rejects invalid timestamps", () => {
    const result = parseCandump("(not-a-time) can0 100#00\n");
    expect(result.frames).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/invalid timestamp/);
  });
});

describe("DBC definition validation", () => {
  function dbcWith(messageLine: string, signalLine?: string): string {
    return [messageLine, signalLine].filter(Boolean).join("\n");
  }

  it("rejects zero-length signals", () => {
    expect(() =>
      parseDbc(
        dbcWith(
          "BO_ 256 Bad: 8 ECU",
          'SG_ Bad : 0|0@1+ (1,0) [0|1] "" ECU',
        ),
      ),
    ).toThrow(/Invalid length 0/);
  });

  it("rejects signals that extend past the DLC", () => {
    expect(() =>
      parseDbc(
        dbcWith(
          "BO_ 256 Bad: 8 ECU",
          'SG_ Bad : 60|8@1+ (1,0) [0|1] "" ECU',
        ),
      ),
    ).toThrow(/extends past the message DLC/);
  });

  it("rejects a zero factor", () => {
    expect(() =>
      parseDbc(
        dbcWith(
          "BO_ 256 Bad: 8 ECU",
          'SG_ Bad : 0|8@1+ (0,0) [0|1] "" ECU',
        ),
      ),
    ).toThrow(/factor must be finite and non-zero/);
  });

  it("rejects a min greater than max", () => {
    expect(() =>
      parseDbc(
        dbcWith(
          "BO_ 256 Bad: 8 ECU",
          'SG_ Bad : 0|8@1+ (1,0) [10|0] "" ECU',
        ),
      ),
    ).toThrow(/min 10 is greater than max 0/);
  });

  it("rejects invalid message DLC values", () => {
    expect(() => parseDbc("BO_ 256 Bad: 9 ECU")).toThrow(/Invalid DLC 9/);
  });

  it("rejects message IDs beyond 29 bits", () => {
    expect(() => parseDbc("BO_ 536870912 Bad: 8 ECU")).toThrow(
      /Invalid message id/,
    );
  });

  it("rejects duplicate message IDs", () => {
    expect(() =>
      parseDbc(
        [
          "BO_ 256 First: 8 ECU",
          "BO_ 256 Second: 8 ECU",
        ].join("\n"),
      ),
    ).toThrow(/Duplicate message id 256/);
  });

  it("rejects duplicate signal names in one message", () => {
    expect(() =>
      parseDbc(
        [
          "BO_ 256 Bad: 8 ECU",
          'SG_ Same : 0|8@1+ (1,0) [0|1] "" ECU',
          'SG_ Same : 8|8@1+ (1,0) [0|1] "" ECU',
        ].join("\n"),
      ),
    ).toThrow(/Duplicate signal "Same"/);
  });

  it("rejects multiplexed signals instead of misdecoding them", () => {
    expect(() =>
      parseDbc(
        [
          "BO_ 256 Muxed: 8 ECU",
          'SG_ MuxedSignal m0 : 0|8@1+ (1,0) [0|1] "" ECU',
          'SG_ Selector M : 8|8@1+ (1,0) [0|1] "" ECU',
        ].join("\n"),
      ),
    ).toThrow(/Multiplexed signals are not supported yet: MuxedSignal/);
  });
});

describe("codec value validation", () => {
  it("rejects frames that are too short for a signal", () => {
    expect(() => decodeFrame(dbc, 256, new Uint8Array(1))).toThrow(
      /requires at least 2/,
    );
  });

  it("rejects negative values for unsigned signals", () => {
    expect(() => encodeFrame(dbc, 256, { Speed_kmh: -1 })).toThrow(
      /out of range/,
    );
  });

  it("rejects values larger than the signal can represent", () => {
    expect(() => encodeFrame(dbc, 256, { Speed_kmh: 10000 })).toThrow(
      /out of range/,
    );
  });

  it("rejects non-finite physical values", () => {
    expect(() => encodeFrame(dbc, 256, { Speed_kmh: Number.NaN })).toThrow(
      /finite number/,
    );
  });
});

describe("decodeLog robustness", () => {
  it("returns a valid empty result", () => {
    const log = decodeLog(dbc, []);
    expect(log.samples).toEqual([]);
    expect(log.unknownIds.size).toBe(0);
    expect(log.startTimestamp).toBe(0);
    expect(log.durationSec).toBe(0);
    expect(log.warnings).toEqual([]);
    expect(log.statistics.totalFrames).toBe(0);
  });

  it("counts unknown message IDs", () => {
    const log = decodeLog(dbc, [
      frame(1, 0x7ff, new Array<number>(8).fill(0)),
      frame(2, 0x7ff, new Array<number>(8).fill(0)),
    ]);

    expect(log.samples).toHaveLength(0);
    expect(log.unknownIds.get(0x7ff)).toBe(2);
    expect(log.statistics.unknownFrames).toBe(2);
    expect(log.statistics.decodedFrames).toBe(0);
  });

  it("sorts non-monotonic input and warns about it", () => {
    const log = decodeLog(dbc, [
      frame(10, 256, speedFrame),
      frame(5, 256, speedFrame),
    ]);

    expect(log.startTimestamp).toBe(5);
    expect(log.durationSec).toBe(5);
    expect(log.samples.map((sample) => sample.t)).toEqual([0, 5]);
    expect(log.frames.map((entry) => entry.timestamp)).toEqual([5, 10]);
    expect(
      log.warnings.some((warning) => /not in chronological order/.test(warning)),
    ).toBe(true);
  });

  it("skips short frames with a warning instead of throwing", () => {
    const log = decodeLog(dbc, [frame(1, 256, [0xf4])]);

    expect(log.samples).toHaveLength(0);
    expect(log.statistics.skippedFrames).toBe(1);
    expect(log.warnings[0]).toMatch(/requires at least 2/);
  });

  it("decodes long frames but warns about bytes beyond the DLC", () => {
    const log = decodeLog(dbc, [
      frame(1, 256, [...speedFrame, 0x99]),
    ]);

    expect(log.samples).toHaveLength(1);
    expect(log.samples[0]!.signals.Speed_kmh!.value).toBe(50);
    expect(log.statistics.decodedFrames).toBe(1);
    expect(
      log.warnings.some((warning) => /extra bytes were ignored/.test(warning)),
    ).toBe(true);
  });
});