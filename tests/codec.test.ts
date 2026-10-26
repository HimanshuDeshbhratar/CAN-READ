import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame } from "../src/core/codec.js";
import { parseDbc } from "../src/core/dbc.js";

const dbc = parseDbc(
  readFileSync(new URL("../samples/vehicle.dbc", import.meta.url), "utf8"),
);

const VEHICLE_SPEED = 256;
const ENGINE_STATUS = 512;
const BRAKE_STATUS = 768;
const GEAR_STATUS = 1024;

function toHex(bytes: Uint8Array): string[] {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase());
}

describe("encodeFrame", () => {
  it("encodes Speed_kmh=50 as F4 01 00 00 00 00 00 00", () => {
    const bytes = encodeFrame(dbc, VEHICLE_SPEED, { Speed_kmh: 50 });
    expect(toHex(bytes)).toEqual(["F4", "01", "00", "00", "00", "00", "00", "00"]);
  });

  it("encodes Speed_kmh=123.4 as D2 04 00 00 00 00 00 00", () => {
    const bytes = encodeFrame(dbc, VEHICLE_SPEED, { Speed_kmh: 123.4 });
    expect(toHex(bytes)).toEqual(["D2", "04", "00", "00", "00", "00", "00", "00"]);
  });

  it("encodes RPM=800 and CoolantTemp_C=70 as 20 03 6E 00 00 00 00 00", () => {
    const bytes = encodeFrame(dbc, ENGINE_STATUS, {
      RPM: 800,
      CoolantTemp_C: 70,
    });
    expect(toHex(bytes)).toEqual(["20", "03", "6E", "00", "00", "00", "00", "00"]);
  });

  it("encodes BrakePressure_pct=90 and ABS_Active=1 as 5A 01 00 00 00 00 00 00", () => {
    const bytes = encodeFrame(dbc, BRAKE_STATUS, {
      BrakePressure_pct: 90,
      ABS_Active: 1,
    });
    expect(toHex(bytes)).toEqual(["5A", "01", "00", "00", "00", "00", "00", "00"]);
  });

  it("encodes GearPosition=3 as 03 00 00 00 00 00 00 00", () => {
    const bytes = encodeFrame(dbc, GEAR_STATUS, { GearPosition: 3 });
    expect(toHex(bytes)).toEqual(["03", "00", "00", "00", "00", "00", "00", "00"]);
  });
});

describe("decodeFrame", () => {
  it("decodes Speed_kmh=50", () => {
    const frame = decodeFrame(dbc, VEHICLE_SPEED, new Uint8Array([0xf4, 0x01, 0, 0, 0, 0, 0, 0]));
    expect(frame?.messageName).toBe("VehicleSpeed");
    expect(frame?.signals.Speed_kmh).toEqual({
      value: 50,
      raw: 500,
      unit: "km/h",
    });
  });

  it("decodes Speed_kmh=123.4", () => {
    const frame = decodeFrame(dbc, VEHICLE_SPEED, new Uint8Array([0xd2, 0x04, 0, 0, 0, 0, 0, 0]));
    expect(frame?.signals.Speed_kmh?.value).toBeCloseTo(123.4, 10);
    expect(frame?.signals.Speed_kmh?.raw).toBe(1234);
  });

  it("decodes RPM=800 and CoolantTemp_C=70", () => {
    const frame = decodeFrame(dbc, ENGINE_STATUS, new Uint8Array([0x20, 0x03, 0x6e, 0, 0, 0, 0, 0]));
    expect(frame?.signals.RPM?.value).toBe(800);
    expect(frame?.signals.CoolantTemp_C?.value).toBe(70);
    expect(frame?.signals.CoolantTemp_C?.raw).toBe(110);
  });

  it("decodes BrakePressure_pct=90 and ABS_Active=1", () => {
    const frame = decodeFrame(dbc, BRAKE_STATUS, new Uint8Array([0x5a, 0x01, 0, 0, 0, 0, 0, 0]));
    expect(frame?.signals.BrakePressure_pct?.value).toBe(90);
    expect(frame?.signals.ABS_Active?.value).toBe(1);
  });

  it("decodes GearPosition=3 with its value-table label", () => {
    const frame = decodeFrame(dbc, GEAR_STATUS, new Uint8Array([0x03, 0, 0, 0, 0, 0, 0, 0]));
    expect(frame?.signals.GearPosition).toEqual({
      value: 3,
      raw: 3,
      unit: "",
      label: "D",
    });
  });

  it("returns null for an unknown message id", () => {
    expect(decodeFrame(dbc, 0x7ff, new Uint8Array(8))).toBeNull();
  });
});

describe("signed signals", () => {
  const signedDbc = parseDbc(
    [
      "BO_ 512 Temperature: 8 ECU",
      'SG_ Temperature_C : 0|16@1- (0.5,0) [-40|100] "C" ECU',
    ].join("\n"),
  );

  it("round-trips a negative physical value", () => {
    const bytes = encodeFrame(signedDbc, 512, { Temperature_C: -12.5 });
    expect(toHex(bytes)).toEqual(["E7", "FF", "00", "00", "00", "00", "00", "00"]);

    const frame = decodeFrame(signedDbc, 512, bytes);
    expect(frame?.signals.Temperature_C?.raw).toBe(-25);
    expect(frame?.signals.Temperature_C?.value).toBeCloseTo(-12.5, 10);
  });
});
