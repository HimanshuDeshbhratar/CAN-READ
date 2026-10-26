import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSampleLog } from "../scripts/generate-sample.js";
import { parseCandump } from "../src/core/candump.js";
import { parseDbc } from "../src/core/dbc.js";
import { decodeLog, type DecodedSample } from "../src/core/decodeLog.js";

const logText = readFileSync(
  new URL("../samples/drive_demo.log", import.meta.url),
  "utf8",
);
const dbc = parseDbc(
  readFileSync(new URL("../samples/vehicle.dbc", import.meta.url), "utf8"),
);

const { frames, warnings } = parseCandump(logText);
const { samples, unknownIds, durationSec } = decodeLog(dbc, frames);

function samplesFor(messageName: string): DecodedSample[] {
  return samples.filter((sample) => sample.messageName === messageName);
}

function nearest(messageName: string, t: number): DecodedSample | undefined {
  let best: DecodedSample | undefined;
  for (const sample of samplesFor(messageName)) {
    if (best === undefined || Math.abs(sample.t - t) < Math.abs(best.t - t)) {
      best = sample;
    }
  }
  return best;
}

function valueNear(
  messageName: string,
  signalName: string,
  t: number,
): number | undefined {
  return nearest(messageName, t)?.signals[signalName]?.value;
}

describe("generated sample log", () => {
  it("parses cleanly and decodes every frame", () => {
    expect(warnings).toEqual([]);
    expect(frames.length).toBeGreaterThan(0);
    expect(samples.length).toBe(frames.length);
    expect(unknownIds.size).toBe(0);
  });

  it("has strictly increasing timestamps", () => {
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.timestamp).toBeGreaterThan(frames[i - 1]!.timestamp);
    }
  });

  it("covers about 60 seconds", () => {
    expect(durationSec).toBeGreaterThanOrEqual(59.5);
    expect(durationSec).toBeLessThanOrEqual(60.5);
  });

  it("keeps the vehicle parked before t=10", () => {
    const speeds = samplesFor("VehicleSpeed").filter(
      (sample) => sample.t < 10,
    );
    expect(speeds.length).toBeGreaterThan(0);
    for (const sample of speeds) {
      expect(Math.abs(sample.signals.Speed_kmh!.value - 0)).toBeLessThanOrEqual(1);
    }
  });

  it("cruises at about 50 km/h at t=30", () => {
    const speed = valueNear("VehicleSpeed", "Speed_kmh", 30);
    expect(speed).toBeDefined();
    expect(Math.abs(speed! - 50)).toBeLessThanOrEqual(2);
  });

  it("has slowed to about 15 km/h by t=43", () => {
    const speed = valueNear("VehicleSpeed", "Speed_kmh", 43);
    expect(speed).toBeDefined();
    expect(Math.abs(speed! - 15)).toBeLessThanOrEqual(3);
  });

  it("drops WheelSpeed frames during the sensor dropout", () => {
    const wheelSpeedSamples = samplesFor("WheelSpeed");
    const duringDropout = wheelSpeedSamples.filter(
      (sample) => sample.t > 50.2 && sample.t < 52.8,
    );
    expect(duringDropout).toHaveLength(0);

    const before = nearest("WheelSpeed", 49.5);
    expect(before).toBeDefined();
    expect(Math.abs(before!.t - 49.5)).toBeLessThanOrEqual(0.3);

    const after = nearest("WheelSpeed", 53.5);
    expect(after).toBeDefined();
    expect(Math.abs(after!.t - 53.5)).toBeLessThanOrEqual(0.3);
  });

  it("sets ABS_Active during the hard brake only", () => {
    expect(valueNear("BrakeStatus", "ABS_Active", 42)).toBe(1);
    expect(valueNear("BrakeStatus", "ABS_Active", 45)).toBe(0);
  });

  it("reports the gear value-table labels", () => {
    expect(
      nearest("GearStatus", 5)?.signals.GearPosition?.label,
    ).toBe("P");
    expect(
      nearest("GearStatus", 15)?.signals.GearPosition?.label,
    ).toBe("D");
  });

  it("warms the coolant over the drive", () => {
    expect(valueNear("EngineStatus", "CoolantTemp_C", 55)).toBeLessThan(105);
    expect(valueNear("EngineStatus", "CoolantTemp_C", 59.5)).toBeGreaterThan(105);
  });

  it("generates identical content on every call", () => {
    expect(generateSampleLog()).toBe(generateSampleLog());
  });
});