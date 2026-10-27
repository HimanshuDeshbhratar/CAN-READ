import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnalysisError, analyze } from "../src/services/analysis.js";

const logText = readFileSync(
  new URL("../samples/drive_demo.log", import.meta.url),
  "utf8",
);
const dbcText = readFileSync(
  new URL("../samples/vehicle.dbc", import.meta.url),
  "utf8",
);

describe("analyze", () => {
  it("runs the full pipeline on the bundled sample", () => {
    const result = analyze({ logText, dbcText });

    expect(result.version).toBe(1);
    expect(result.statistics.totalFrames).toBe(4440);
    expect(result.statistics.decodedFrames).toBe(4440);
    expect(result.statistics.logDurationSec).toBeGreaterThan(59.5);
    expect(result.statistics.messageCount).toBe(5);
    expect(result.statistics.signalCount).toBe(7);
    expect(result.unknownIds).toEqual([]);
    expect(result.events).toHaveLength(5);
    expect(result.timeline.entries).toHaveLength(3);
    expect(result.warnings).toEqual([]);
    expect(result.unsupported).toEqual([]);

    const braking = result.timeline.entries.find(
      (entry) => entry.theme === "braking",
    );
    expect(braking).toBeDefined();
    expect(braking!.eventIds).toEqual([
      "rapid_deceleration-1",
      "brake_activity-1",
      "abs_activation-1",
    ]);
  });

  it("reports decoded signal metadata and sample counts", () => {
    const result = analyze({ logText, dbcText });

    const gear = result.signals.find(
      (signal) => signal.signalName === "GearPosition",
    );
    expect(gear).toBeDefined();
    expect(gear!.messageId).toBe(1024);
    expect(gear!.unit).toBe("");
    expect(gear!.valueTable).toEqual({ 3: "D", 2: "N", 1: "R", 0: "P" });
    expect(gear!.sampleCount).toBe(300);
  });

  it("returns chartable series without interpolated points", () => {
    const result = analyze({ logText, dbcText });

    expect(result.series).toHaveLength(7);

    const speed = result.series.find(
      (signal) => signal.signalName === "Speed_kmh",
    );
    expect(speed).toBeDefined();
    expect(speed!.totalPoints).toBe(1200);
    expect(speed!.truncated).toBe(false);
    expect(speed!.points[0]!.t).toBeGreaterThanOrEqual(0);
    expect(speed!.points[0]!.value).toBeGreaterThanOrEqual(0);

    const wheel = result.series.find(
      (signal) => signal.signalName === "WheelSpeed_kmh",
    );
    expect(wheel).toBeDefined();
    expect(wheel!.totalPoints).toBe(1140);
    expect(wheel!.points.some((point) => point.t > 50 && point.t < 53)).toBe(
      false,
    );
  });

  it("continues without a DBC but warns and skips decoding", () => {
    const result = analyze({ logText });

    expect(result.signals).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.unknownIds).toHaveLength(5);
    expect(
      result.warnings.some((warning) =>
        warning.includes("No DBC file was supplied"),
      ),
    ).toBe(true);
  });

  it("rejects an empty log", () => {
    expect(() => analyze({ logText: "   ", dbcText })).toThrow(AnalysisError);
    try {
      analyze({ logText: "   ", dbcText });
    } catch (error) {
      expect((error as AnalysisError).code).toBe("empty_log");
    }
  });

  it("rejects malformed DBC content", () => {
    try {
      analyze({ logText, dbcText: 'BO_ 256 Bad: 8 ECU\nSG_ Bad : 0|0@1+ (1,0) [0|1] "" ECU' });
      throw new Error("expected analyze to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AnalysisError);
      expect((error as AnalysisError).code).toBe("invalid_dbc");
    }
  });

  it("rejects logs without valid frames", () => {
    try {
      analyze({ logText: "not a candump line", dbcText });
      throw new Error("expected analyze to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AnalysisError);
      expect((error as AnalysisError).code).toBe("no_frames");
    }
  });

  it("enforces the configured log size limit", () => {
    try {
      analyze({ logText, dbcText, limits: { maxLogBytes: 100 } });
      throw new Error("expected analyze to throw");
    } catch (error) {
      expect((error as AnalysisError).code).toBe("log_too_large");
    }
  });
});