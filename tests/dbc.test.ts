import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDbc } from "../src/core/dbc.js";

const sampleDbc = readFileSync(
  new URL("../samples/vehicle.dbc", import.meta.url),
  "utf8",
);

describe("parseDbc", () => {
  it("parses all messages and signals from the sample DBC", () => {
    const dbc = parseDbc(sampleDbc);

    expect(dbc.messages.size).toBe(5);
    expect([...dbc.messages.keys()]).toEqual([256, 272, 512, 768, 1024]);

    const signalCount = [...dbc.messages.values()].reduce(
      (total, message) => total + message.signals.length,
      0,
    );
    expect(signalCount).toBe(7);
  });

  it("parses message and signal details", () => {
    const dbc = parseDbc(sampleDbc);

    const engine = dbc.messages.get(512);
    expect(engine).toMatchObject({ id: 512, name: "EngineStatus", dlc: 8 });
    expect(engine?.signals).toEqual([
      {
        name: "RPM",
        startBit: 0,
        length: 16,
        littleEndian: true,
        signed: false,
        factor: 1,
        offset: 0,
        min: 0,
        max: 8000,
        unit: "rpm",
      },
      {
        name: "CoolantTemp_C",
        startBit: 16,
        length: 8,
        littleEndian: true,
        signed: false,
        factor: 1,
        offset: -40,
        min: -40,
        max: 215,
        unit: "C",
      },
    ]);

    const gear = dbc.messages.get(1024);
    expect(gear?.signals[0]).toMatchObject({
      name: "GearPosition",
      startBit: 0,
      length: 4,
      valueTable: { 3: "D", 2: "N", 1: "R", 0: "P" },
    });
  });

  it("handles Windows line endings and extra whitespace", () => {
    const text = [
      "BO_ 256 VehicleSpeed: 8 ECU",
      '  SG_   Speed_kmh   :   0|16@1+   (0.1,0)   [0|250]   "km/h"   Vector__XXX',
      "",
    ].join("\r\n");

    const dbc = parseDbc(text);
    const message = dbc.messages.get(256);
    expect(message?.signals).toHaveLength(1);
    expect(message?.signals[0]).toMatchObject({
      name: "Speed_kmh",
      factor: 0.1,
      unit: "km/h",
    });
  });

  it("throws a clear error for big-endian signals", () => {
    const text = [
      "BO_ 256 BigEndianMessage: 8 ECU",
      'SG_ BigEndianSignal : 0|16@0+ (1,0) [0|100] "" ECU',
    ].join("\n");

    expect(() => parseDbc(text)).toThrow(
      "Big-endian signals are not supported yet: BigEndianSignal",
    );
  });
});
